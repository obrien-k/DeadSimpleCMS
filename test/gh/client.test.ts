import { describe, expect, it } from 'vitest';
import { createClient, GhError } from '../../src/gh/index.js';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

type Route = (call: Call) => Response | undefined;

// Fake fetch: records every request, answers from the given routes.
function fake(routes: Route[]) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    for (const route of routes) {
      const res = route(call);
      if (res) return res;
    }
    throw new Error(`unrouted request: ${call.method} ${call.url}`);
  };
  return { calls, fetchImpl };
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const client = (fetchImpl: typeof fetch) =>
  createClient({ token: 'github_pat_x', repo: 'owner/site', fetch: fetchImpl });

describe('request helper', () => {
  it('sends the token and API version on REST calls', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_: string | URL, init?: RequestInit) => {
      captured = init;
      return json({ ok: true });
    };
    await client(fetchImpl as typeof fetch).getRepo();
    const headers = captured!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer github_pat_x');
    expect(headers['X-GitHub-Api-Version']).toBeDefined();
  });

  it('throws GhError with status and message on a REST failure', async () => {
    const { fetchImpl } = fake([() => json({ message: 'Not Found' }, 404)]);
    await expect(client(fetchImpl as typeof fetch).getRepo()).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('Not Found'),
    });
  });

  it('captures the token expiry header', async () => {
    const { fetchImpl } = fake([
      () => json({}, 200, { 'github-authentication-token-expiration': '2026-12-01 00:00:00 UTC' }),
    ]);
    const c = client(fetchImpl as typeof fetch);
    await c.getRepo();
    expect(c.tokenExpiry()).toEqual(new Date('2026-12-01T00:00:00Z'));
  });

  it('GraphQL: HTTP 200 with an errors array is a failure, not a success', async () => {
    // The REST-shaped trap: res.ok is true here. One shared helper must catch it.
    const { fetchImpl } = fake([
      (c) =>
        c.url.endsWith('/graphql')
          ? json({ data: null, errors: [{ message: 'Bad credentials' }] })
          : undefined,
    ]);
    await expect(client(fetchImpl as typeof fetch).listEntries()).rejects.toThrow(
      /Bad credentials/,
    );
  });
});

describe('listing', () => {
  it('returns posts and drafts from the two aliases', async () => {
    const { fetchImpl } = fake([
      () =>
        json({
          data: {
            repository: {
              posts: { entries: [{ name: '2026-07-01-a.md', oid: 'oid-a' }] },
              drafts: { entries: [{ name: 'wip.md', oid: 'oid-w' }] },
            },
          },
        }),
    ]);
    const listing = await client(fetchImpl as typeof fetch).listEntries();
    expect(listing.posts).toEqual([{ name: '2026-07-01-a.md', oid: 'oid-a' }]);
    expect(listing.drafts).toEqual([{ name: 'wip.md', oid: 'oid-w' }]);
  });

  it('a missing _drafts directory is normal, not an error', async () => {
    const { fetchImpl } = fake([
      () => json({ data: { repository: { posts: { entries: [] }, drafts: null } } }),
    ]);
    const listing = await client(fetchImpl as typeof fetch).listEntries();
    expect(listing.drafts).toEqual([]);
  });

  it('fetches blobs by oid aliases and reports binary ones', async () => {
    const { calls, fetchImpl } = fake([
      () =>
        json({
          data: {
            repository: {
              b0: { text: '---\ntitle: A\n---\n', isBinary: false, isTruncated: false },
              b1: { text: null, isBinary: true, isTruncated: false },
            },
          },
        }),
    ]);
    const blobs = await client(fetchImpl as typeof fetch).fetchBlobs(['oid-a', 'oid-b']);
    expect((calls[0]!.body as { query: string }).query).toContain('b0: object(oid: "oid-a")');
    expect(blobs.get('oid-a')).toEqual({
      text: '---\ntitle: A\n---\n',
      isBinary: false,
      isTruncated: false,
    });
    expect(blobs.get('oid-b')!.isBinary).toBe(true);
  });
});

describe('single-file read', () => {
  it('decodes base64 content with TextDecoder (unicode intact)', async () => {
    const text = '---\ntitle: café 🎉\n---\n\nBody 日本語.\n';
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    const { fetchImpl } = fake([() => json({ content: b64, sha: 'abc123', encoding: 'base64' })]);
    const file = await client(fetchImpl as typeof fetch).readFile('_posts/2026-07-01-a.md');
    expect(file).toEqual({ text, sha: 'abc123' });
  });
});

describe('atomic commit (Git Data)', () => {
  const HEAD = 'head-sha';
  const happyRoutes = (calls: Call[]): Route[] => [
    (c) =>
      c.url.includes('/git/ref/heads/main')
        ? json({ object: { sha: HEAD } })
        : undefined,
    (c) => (c.url.includes(`/git/commits/${HEAD}`) ? json({ tree: { sha: 'tree-0' } }) : undefined),
    (c) =>
      c.method === 'POST' && c.url.includes('/git/blobs')
        ? json({ sha: `blob-${calls.filter((x) => x.url.includes('/git/blobs')).length}` })
        : undefined,
    (c) => (c.method === 'POST' && c.url.includes('/git/trees') ? json({ sha: 'tree-1' }) : undefined),
    (c) =>
      c.method === 'POST' && c.url.includes('/git/commits') ? json({ sha: 'commit-1' }) : undefined,
    (c) =>
      c.method === 'PATCH' && c.url.includes('/git/refs/heads/main')
        ? json({ object: { sha: 'commit-1' } })
        : undefined,
  ];

  it('publish move = one commit: new path added, old path tombstoned, force:false', async () => {
    const { calls, fetchImpl } = fake([]);
    fake([]); // (silence unused warning pattern)
    const recorded = fake(happyRoutes([]));
    const c = createClient({ token: 't', repo: 'owner/site', fetch: recorded.fetchImpl as typeof fetch });
    const result = await c.commit({
      branch: 'main',
      message: 'Publish: my post',
      changes: [{ path: '_posts/2026-07-16-my-post.md', content: 'content' }],
      deletions: ['_drafts/my-post.md'],
      expectedHeadSha: HEAD,
    });
    expect(result.sha).toBe('commit-1');

    const treeCall = recorded.calls.find((x) => x.method === 'POST' && x.url.includes('/git/trees'))!;
    expect(treeCall.body).toMatchObject({
      base_tree: 'tree-0',
      tree: expect.arrayContaining([
        expect.objectContaining({ path: '_posts/2026-07-16-my-post.md', sha: expect.any(String) }),
        expect.objectContaining({ path: '_drafts/my-post.md', sha: null }),
      ]),
    });

    // force:false is the entire concurrency safety property. Never true.
    const refCall = recorded.calls.find((x) => x.method === 'PATCH')!;
    expect((refCall.body as { force: boolean }).force).toBe(false);
    void calls;
  });

  it('refuses before any write when HEAD moved since read (client CAS)', async () => {
    const recorded = fake([
      (c) => (c.url.includes('/git/ref/') ? json({ object: { sha: 'someone-elses-sha' } }) : undefined),
    ]);
    const c = createClient({ token: 't', repo: 'owner/site', fetch: recorded.fetchImpl as typeof fetch });
    await expect(
      c.commit({ branch: 'main', message: 'm', changes: [{ path: 'a.md', content: 'x' }], expectedHeadSha: HEAD }),
    ).rejects.toMatchObject({ conflict: true });
    expect(recorded.calls.filter((x) => x.method !== 'GET')).toEqual([]);
  });

  it('surfaces the server-side 422 non-fast-forward as a conflict', async () => {
    const routes = happyRoutes([]);
    routes[routes.length - 1] = (c) =>
      c.method === 'PATCH' ? json({ message: 'Update is not a fast forward' }, 422) : undefined;
    const recorded = fake(routes);
    const c = createClient({ token: 't', repo: 'owner/site', fetch: recorded.fetchImpl as typeof fetch });
    await expect(
      c.commit({ branch: 'main', message: 'm', changes: [{ path: 'a.md', content: 'x' }], expectedHeadSha: HEAD }),
    ).rejects.toMatchObject({ conflict: true });
  });

  it('encodes blob content via TextEncoder so unicode survives', async () => {
    const recorded = fake(happyRoutes([]));
    const c = createClient({ token: 't', repo: 'owner/site', fetch: recorded.fetchImpl as typeof fetch });
    await c.commit({
      branch: 'main',
      message: 'm',
      changes: [{ path: 'a.md', content: 'emoji 🎉 café 日本語' }],
      expectedHeadSha: HEAD,
    });
    const blobCall = recorded.calls.find((x) => x.url.includes('/git/blobs'))!;
    const body = blobCall.body as { content: string; encoding: string };
    expect(body.encoding).toBe('base64');
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('emoji 🎉 café 日本語');
  });
});

describe('pages and deployments', () => {
  it('getPages returns null on 404 (Pages not configured)', async () => {
    const { fetchImpl } = fake([() => json({ message: 'Not Found' }, 404)]);
    expect(await client(fetchImpl as typeof fetch).getPages()).toBeNull();
  });

  it('getPages returns the config when Pages is on', async () => {
    const { fetchImpl } = fake([() => json({ html_url: 'https://o.github.io/site/', status: 'built' })]);
    expect((await client(fetchImpl as typeof fetch).getPages())!.html_url).toBe(
      'https://o.github.io/site/',
    );
  });

  it('finds the github-pages deployment for a sha and reads its statuses', async () => {
    const { calls, fetchImpl } = fake([
      (c) =>
        c.url.includes('/deployments?')
          ? json([{ id: 7, sha: 'commit-1', environment: 'github-pages' }])
          : undefined,
      (c) =>
        c.url.includes('/deployments/7/statuses')
          ? json([{ state: 'success', environment_url: 'https://example.com/' }])
          : undefined,
    ]);
    const c = client(fetchImpl as typeof fetch);
    const dep = await c.getDeployment('commit-1');
    expect(dep!.id).toBe(7);
    expect(calls[0]!.url).toContain('sha=commit-1');
    expect(calls[0]!.url).toContain('environment=github-pages');
    const statuses = await c.getDeploymentStatuses(7);
    expect(statuses[0]!.state).toBe('success');
  });
});

describe('write probe', () => {
  it('posts a dangling blob and resolves true on success', async () => {
    const { calls, fetchImpl } = fake([
      (c) => (c.method === 'POST' && c.url.includes('/git/blobs') ? json({ sha: 'b' }, 201) : undefined),
    ]);
    expect(await client(fetchImpl as typeof fetch).probeWrite()).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('resolves false on the deliberate wrong-repo/unscoped/no-permission 404', async () => {
    const { fetchImpl } = fake([() => json({ message: 'Not Found' }, 404)]);
    expect(await client(fetchImpl as typeof fetch).probeWrite()).toBe(false);
  });
});

describe('GhError', () => {
  it('is an Error with a status', () => {
    const e = new GhError('nope', 500);
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(500);
  });
});
