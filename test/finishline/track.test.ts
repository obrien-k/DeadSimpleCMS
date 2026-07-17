import { describe, expect, it } from 'vitest';
import { trackPublish, type FinishLineEvent } from '../../src/finishline/index.js';
import type { BuildState, Deployment, DeploymentStatus, PagesInfo, RepoInfo } from '../../src/gh/index.js';

const SITE = 'https://kyle.example.com/blog/';

interface FakeOpts {
  pages?: PagesInfo | null;
  private?: boolean;
  build?: BuildState[]; // per-poll build check-run states (defaults to one success)
  buildLog?: string | null; // what getBuildLog returns on failure
  deploymentAfter?: number; // polls before the deployment appears
  sitemap?: string | null; // null = 404
  liveUrls?: string[];
}

function fakes(opts: FakeOpts) {
  let deploymentPolls = 0;
  let buildPolls = 0;
  const build = opts.build ?? [{ status: 'completed', conclusion: 'success' }];
  const gh = {
    getPages: async () =>
      'pages' in opts ? opts.pages! : ({ html_url: SITE, status: 'built' } as PagesInfo),
    getRepo: async (): Promise<RepoInfo> => ({
      default_branch: 'main',
      private: opts.private ?? false,
    }),
    getBuildState: async (): Promise<BuildState> =>
      build[Math.min(buildPolls++, build.length - 1)]!,
    getBuildLog: async (): Promise<string | null> => opts.buildLog ?? null,
    getDeployment: async (): Promise<Deployment | null> =>
      ++deploymentPolls > (opts.deploymentAfter ?? 0)
        ? { id: 7, sha: 's', environment: 'github-pages' }
        : null,
    getDeploymentStatuses: async (): Promise<DeploymentStatus[]> => [
      { state: 'success', environment_url: SITE.replace(/\/$/, '') },
    ],
  };
  const fetchSite = async (input: string | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('sitemap.xml')) {
      return opts.sitemap == null
        ? new Response('nope', { status: 404 })
        : new Response(opts.sitemap, { status: 200 });
    }
    return new Response('page', { status: (opts.liveUrls ?? []).includes(url) ? 200 : 404 });
  };
  return { gh, fetchSite: fetchSite as typeof fetch, sleep: async () => {} };
}

async function drain(gen: AsyncGenerator<FinishLineEvent>): Promise<FinishLineEvent[]> {
  const out: FinishLineEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const sitemapWith = (...locs: string[]) =>
  `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;

const TARGET = { sha: 's', slug: 'my-post', front: { title: 'T', date: '2026-07-01 10:00:00 +0000' } };
const NOW = () => new Date('2026-07-16T12:00:00Z');

describe('trackPublish', () => {
  it('no Pages configured is one call, not a timeout', async () => {
    const f = fakes({ pages: null });
    const events = await drain(trackPublish({ ...f, now: NOW }, TARGET));
    expect(events).toEqual([{ kind: 'no-pages' }]);
  });

  // GET /pages 404s both when Pages is off and when the repo is private and the
  // token lacks Pages:read. Reporting the second as the first tells a paying
  // user their live site is switched off (#17).
  it('a private repo cannot be told "Pages is not turned on"', async () => {
    const f = fakes({ pages: null, private: true });
    const events = await drain(trackPublish({ ...f, now: NOW }, TARGET));
    expect(events).toEqual([{ kind: 'pages-unreadable' }]);
  });

  it('happy path: publishing → building → live at the sitemap URL, verified reachable', async () => {
    const url = `${SITE}2026/07/01/my-post.html`;
    const f = fakes({
      deploymentAfter: 1,
      build: [
        { status: 'queued', conclusion: null },
        { status: 'in_progress', conclusion: null },
        { status: 'completed', conclusion: 'success' },
      ],
      sitemap: sitemapWith(`${SITE}index.html`, url),
      liveUrls: [url],
    });
    const events = await drain(trackPublish({ ...f, now: NOW }, TARGET));
    expect(events).toEqual([
      { kind: 'publishing' },
      { kind: 'building', state: 'queued' },
      { kind: 'building', state: 'in_progress' },
      { kind: 'live', url },
    ]);
  });

  const FAILED: BuildState[] = [{ status: 'completed', conclusion: 'failure' }];
  const LIQUID = (path: string) =>
    `Liquid Exception: Liquid syntax error (line 2): 'if' tag was never closed in /github/workspace/${path}`;

  // The design's aspiration, now reachable: the log named the file just
  // published, so the failure is safely attributable to this post (#9).
  it('a failed build that blames the published post is attributed to it', async () => {
    const path = '_posts/2026-07-01-my-post.md';
    const f = fakes({ build: FAILED, buildLog: LIQUID(path) });
    const events = await drain(trackPublish({ ...f, now: NOW }, { ...TARGET, path }));
    expect(events.at(-1)).toEqual({
      kind: 'build-failed',
      cause: { file: path, line: 2, problem: expect.stringContaining("'if' tag was never closed"), mine: true },
    });
  });

  // The break is in a file the user did not touch (a theme). Blaming their post
  // would send them hunting for a mistake they did not make — so mine:false.
  it('a failed build in someone else’s file is not blamed on the post', async () => {
    const f = fakes({ build: FAILED, buildLog: LIQUID('_layouts/default.html') });
    const events = await drain(
      trackPublish({ ...f, now: NOW }, { ...TARGET, path: '_posts/2026-07-01-my-post.md' }),
    );
    expect(events.at(-1)).toMatchObject({ kind: 'build-failed', cause: { mine: false } });
  });

  // No parseable error in the log: the honest floor, no cause at all.
  it('a failed build with no readable cause falls back to the bare failure', async () => {
    const f = fakes({ build: FAILED, buildLog: 'just build chatter, nothing quotable' });
    const events = await drain(trackPublish({ ...f, now: NOW }, TARGET));
    expect(events.at(-1)).toEqual({ kind: 'build-failed' });
  });

  it('detects the baseurl misconfiguration instead of reporting a dead link', async () => {
    // Sitemap emits URLs missing the /blog prefix — the most common Jekyll
    // project-page mistake. Cross-check against environment_url catches it.
    const wrong = 'https://kyle.example.com/2026/07/01/my-post.html';
    const f = fakes({ sitemap: sitemapWith(wrong) });
    const events = await drain(trackPublish({ ...f, now: NOW }, TARGET));
    expect(events.at(-1)).toMatchObject({
      kind: 'baseurl-misconfigured',
      sitemapUrl: wrong,
      siteRoot: SITE,
    });
  });

  it('green build + absent from sitemap + future date = silently skipped, explained locally', async () => {
    const f = fakes({ sitemap: sitemapWith(`${SITE}other.html`) });
    const target = { ...TARGET, front: { title: 'T', date: '2026-07-17 10:00:00 +0000' } };
    const events = await drain(trackPublish({ ...f, now: NOW }, target));
    expect(events.at(-1)).toEqual({ kind: 'skipped', reason: 'future-dated' });
  });

  it('green build + absent + published:false = skipped, explained locally', async () => {
    const f = fakes({ sitemap: sitemapWith(`${SITE}other.html`) });
    const target = { ...TARGET, front: { title: 'T', published: false } };
    const events = await drain(trackPublish({ ...f, now: NOW }, target));
    expect(events.at(-1)).toEqual({ kind: 'skipped', reason: 'unpublished' });
  });

  it('green build + absent + no local explanation = honest not-in-sitemap', async () => {
    const f = fakes({ sitemap: sitemapWith(`${SITE}other.html`) });
    const events = await drain(trackPublish({ ...f, now: NOW }, TARGET, { sitemapRetries: 1 }));
    expect(events.at(-1)).toEqual({ kind: 'not-in-sitemap', siteRoot: SITE });
  });

  it('no sitemap plugin: build success reported without a fabricated URL', async () => {
    const f = fakes({ sitemap: null });
    const events = await drain(trackPublish({ ...f, now: NOW }, TARGET));
    expect(events.at(-1)).toEqual({ kind: 'built-no-sitemap', siteRoot: SITE });
  });

  it('times out if the deployment never appears', async () => {
    const f = fakes({ deploymentAfter: 999 });
    const events = await drain(trackPublish({ ...f, now: NOW }, TARGET, { maxDeploymentPolls: 3 }));
    expect(events.at(-1)).toEqual({ kind: 'timeout' });
  });
});
