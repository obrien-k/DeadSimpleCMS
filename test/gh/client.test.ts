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
    await expect(
      client(fetchImpl as typeof fetch).queryPaths({ branch: 'main', dirs: ['_posts'] }),
    ).rejects.toThrow(/Bad credentials/);
  });
});

describe('queryPaths', () => {
  it('reads trees and files at the named branch, keyed by the path asked for', async () => {
    const { calls, fetchImpl } = fake([
      () =>
        json({
          data: {
            repository: {
              d0: { entries: [{ name: '2026-07-01-a.md', oid: 'oid-a' }] },
              d1: { entries: [{ name: 'wip.md', oid: 'oid-w' }] },
              f0: { text: 'title: Site', isTruncated: false },
            },
          },
        }),
    ]);
    const r = await client(fetchImpl as typeof fetch).queryPaths({
      branch: 'gh-pages',
      dirs: ['docs/_posts', 'docs/_drafts'],
      files: ['docs/_config.yml'],
    });
    expect(r.dirs.get('docs/_posts')).toEqual([{ name: '2026-07-01-a.md', oid: 'oid-a' }]);
    expect(r.dirs.get('docs/_drafts')).toEqual([{ name: 'wip.md', oid: 'oid-w' }]);
    expect(r.files.get('docs/_config.yml')).toBe('title: Site');
    // The branch is in the expression, not `HEAD`: #17's other half is that
    // Pages may build a branch that is not the repo default.
    expect(String((calls[0]!.body as { query: string }).query)).toContain('"gh-pages:docs/_posts"');
  });

  it('a missing path is null, not an error — a site with no _drafts is ordinary', async () => {
    const { fetchImpl } = fake([() => json({ data: { repository: { d0: null } } })]);
    const r = await client(fetchImpl as typeof fetch).queryPaths({
      branch: 'main',
      dirs: ['_drafts'],
    });
    expect(r.dirs.get('_drafts')).toBeNull();
  });

  it('reports a truncated file as absent rather than handing back half of it', async () => {
    const { fetchImpl } = fake([
      () => json({ data: { repository: { f0: { text: 'collections_di', isTruncated: true } } } }),
    ]);
    const r = await client(fetchImpl as typeof fetch).queryPaths({
      branch: 'main',
      files: ['_config.yml'],
    });
    expect(r.files.get('_config.yml')).toBeNull();
  });

  it('getTree returns blob paths with their oids, at the named branch', async () => {
    const { calls, fetchImpl } = fake([
      () =>
        json({
          sha: 't1',
          tree: [
            { path: 'docs', type: 'tree', sha: 'tree-sha' },
            { path: 'docs/_posts/2026-07-01-a.md', type: 'blob', sha: 'blob-a' },
          ],
          truncated: false,
        }),
    ]);
    const r = await client(fetchImpl as typeof fetch).getTree('gh-pages');
    // Directories are implied by the paths; only blobs are content.
    expect(r.files).toEqual([{ path: 'docs/_posts/2026-07-01-a.md', sha: 'blob-a' }]);
    expect(r.truncated).toBe(false);
    expect(calls[0]!.url).toContain('/git/trees/gh-pages?recursive=1');
  });

  it('getTree surfaces truncation instead of passing off a partial tree as whole', async () => {
    const { fetchImpl } = fake([() => json({ tree: [], truncated: true })]);
    expect((await client(fetchImpl as typeof fetch).getTree('main')).truncated).toBe(true);
  });

  it('makes no request when nothing was asked for', async () => {
    const { calls, fetchImpl } = fake([]);
    const r = await client(fetchImpl as typeof fetch).queryPaths({ branch: 'main' });
    expect(calls).toEqual([]);
    expect(r.dirs.size).toBe(0);
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

  // #12 unbounded the caller: page candidates are every markdown file under the
  // source root, not the contents of one directory. 100 is the size #5 actually
  // verified against a real site; where an aliased query breaks is unmeasured,
  // so the batch stays at the number with evidence behind it.
  it('splits a large fetch into batches of 100, and re-keys each batch’s aliases', async () => {
    const oids = Array.from({ length: 250 }, (_, i) => `oid-${i}`);
    const { calls, fetchImpl } = fake(
      Array.from({ length: 3 }, () => () =>
        json({
          data: {
            repository: Object.fromEntries(
              Array.from({ length: 100 }, (_, i) => [
                `b${i}`,
                { text: `t${i}`, isBinary: false, isTruncated: false },
              ]),
            ),
          },
        }),
      ),
    );
    const blobs = await client(fetchImpl as typeof fetch).fetchBlobs(oids);
    expect(calls).toHaveLength(3);

    // Aliases restart at b0 per batch, so batch 2's b0 must map back to oid-100
    // rather than oid-0 — getting this wrong would mis-title every listed file.
    const q = (n: number) => (calls[n]!.body as { query: string }).query;
    expect(q(0)).toContain('b0: object(oid: "oid-0")');
    expect(q(1)).toContain('b0: object(oid: "oid-100")');
    expect(q(2)).toContain('b49: object(oid: "oid-249")');
    expect(q(2)).not.toContain('b50:'); // the tail is short, not padded
    expect(blobs.get('oid-100')!.text).toBe('t0');
    expect(blobs.size).toBe(250);
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

  // An image is bytes, not text — routing it through TextEncoder would corrupt
  // it. Binary content is base64'd straight from the Uint8Array (#14).
  it('base64s binary content directly, without TextEncoder mangling', async () => {
    const recorded = fake(happyRoutes([]));
    const c = createClient({ token: 't', repo: 'owner/site', fetch: recorded.fetchImpl as typeof fetch });
    // Bytes 0xFF 0xD8 — a JPEG SOI marker, invalid UTF-8, so a text path would lose them.
    const bytes = new Uint8Array([0xff, 0xd8, 0x00, 0x41]);
    await c.commit({
      branch: 'main',
      message: 'm',
      changes: [{ path: 'assets/img/x.jpg', content: bytes }],
      expectedHeadSha: HEAD,
    });
    const blobCall = recorded.calls.find((x) => x.url.includes('/git/blobs'))!;
    const body = blobCall.body as { content: string; encoding: string };
    expect(body.encoding).toBe('base64');
    expect([...Buffer.from(body.content, 'base64')]).toEqual([0xff, 0xd8, 0x00, 0x41]);
  });
});

describe('pages and deployments', () => {
  // A 404 here means "Pages is off" OR "private repo, token has no Pages:read".
  // The client cannot tell them apart, so it reports absence and leaves the
  // distinction to a caller holding `private` (#17).
  it('getPages returns null on 404', async () => {
    const { fetchImpl } = fake([() => json({ message: 'Not Found' }, 404)]);
    expect(await client(fetchImpl as typeof fetch).getPages()).toBeNull();
  });

  it('getPages keeps source and build_type — the fields #17 was thrown by', async () => {
    const { fetchImpl } = fake([
      () =>
        json({
          html_url: 'https://o.github.io/site/',
          status: 'built',
          build_type: 'legacy',
          source: { branch: 'gh-pages', path: '/docs' },
        }),
    ]);
    const pages = (await client(fetchImpl as typeof fetch).getPages())!;
    expect(pages.source).toEqual({ branch: 'gh-pages', path: '/docs' });
    expect(pages.build_type).toBe('legacy');
  });

  it('getRepo is fetched once and reused — both fields are read on every load', async () => {
    const { calls, fetchImpl } = fake([() => json({ default_branch: 'main', private: false })]);
    const c = client(fetchImpl as typeof fetch);
    await c.getRepo();
    await c.getDefaultBranch();
    expect(calls.length).toBe(1);
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
