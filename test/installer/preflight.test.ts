import { describe, expect, it } from 'vitest';
import { preflight, adminPrefixFor, type PreflightClient } from '../../src/installer/preflight.js';

const REPO = 'octocat/blog';

// A fake gh client: every method answerable, overridable per test.
function fakeClient(over: Partial<Record<keyof PreflightClient, unknown>> = {}): PreflightClient {
  return {
    probeWrite: async () => true,
    getPages: async () => ({
      html_url: 'https://octocat.github.io/blog/',
      https_enforced: true,
      source: { branch: 'main', path: '/' },
      build_type: 'legacy',
    }),
    getDefaultBranch: async () => 'main',
    // A Jekyll site by default (has _config.yml at the source root), so the
    // Jekyll gate passes and tests can focus on the collision behaviour.
    getTree: async () => ({ files: [{ path: '_config.yml' }], truncated: false }),
    readFile: async () => ({ text: '', sha: 'x' }),
    tokenExpiry: () => null,
    ...(over as object),
  } as PreflightClient;
}

// Meta extractor stub: pull dscms:repo out of a <meta> line without a DOM.
const extractRepoMeta = (html: string): string | null => {
  const m = html.match(/name="dscms:repo"\s+content="([^"]*)"/);
  return m?.[1] ?? null;
};
const deps = { extractRepoMeta };

describe('adminPrefixFor honours the source root (#17)', () => {
  it('root source → admin/', () => expect(adminPrefixFor('/')).toBe('admin/'));
  it('undefined → admin/', () => expect(adminPrefixFor(undefined)).toBe('admin/'));
  it('/docs → docs/admin/', () => expect(adminPrefixFor('/docs')).toBe('docs/admin/'));
});

describe('preflight gate sequence (#29)', () => {
  it('unreachable repo blocks first — no further calls needed', async () => {
    const r = await preflight(fakeClient({ probeWrite: async () => false }), REPO, deps);
    expect(r).toEqual({ ok: false, gate: 'unreachable' });
  });

  it('Pages off blocks before HTTPS', async () => {
    const r = await preflight(fakeClient({ getPages: async () => null }), REPO, deps);
    expect(r).toEqual({ ok: false, gate: 'no-pages' });
  });

  it('Enforce HTTPS off blocks', async () => {
    const r = await preflight(
      fakeClient({
        getPages: async () => ({
          html_url: 'https://octocat.github.io/blog/',
          https_enforced: false,
          source: { branch: 'main', path: '/' },
        }),
      }),
      REPO,
      deps,
    );
    expect(r).toEqual({ ok: false, gate: 'insecure' });
  });

  it('clean repo passes to a clean collision and the live URL', async () => {
    const r = await preflight(fakeClient(), REPO, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.collision.kind).toBe('clean');
    expect(r.liveUrl).toBe('https://octocat.github.io/blog/admin/');
    expect(r.branch).toBe('main');
  });

  it('detects our install for repair via the index.html meta', async () => {
    const r = await preflight(
      fakeClient({
        getTree: async () => ({
          files: [{ path: '_config.yml' }, { path: 'admin/index.html' }, { path: 'admin/bundle.js' }],
          truncated: false,
        }),
        readFile: async () => ({
          text: '<meta name="dscms:repo" content="octocat/blog">',
          sha: 'x',
        }),
      }),
      REPO,
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.collision.kind).toBe('ours');
  });

  it('finds a Decap install and reads admin/ under a /docs root', async () => {
    const r = await preflight(
      fakeClient({
        getPages: async () => ({
          html_url: 'https://octocat.github.io/blog/',
          https_enforced: true,
          source: { branch: 'gh-pages', path: '/docs' },
        }),
        getTree: async () => ({
          files: [
            { path: 'docs/_config.yml' },
            { path: 'docs/admin/index.html' },
            { path: 'docs/admin/config.yml' },
            { path: 'docs/_posts/a.md' },
          ],
          truncated: false,
        }),
        readFile: async () => ({ text: '<html>Decap</html>', sha: 'x' }),
      }),
      REPO,
      deps,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.collision.kind).toBe('decap');
    expect(r.adminPrefix).toBe('docs/admin/');
    expect(r.branch).toBe('gh-pages');
  });

  it('refuses an unknown admin/index.html', async () => {
    const r = await preflight(
      fakeClient({
        getTree: async () => ({
          files: [{ path: '_config.yml' }, { path: 'admin/index.html' }],
          truncated: false,
        }),
        readFile: async () => ({ text: '<html>someone else</html>', sha: 'x' }),
      }),
      REPO,
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.collision.kind).toBe('unknown-index');
  });

  // A non-Jekyll site (no _config.yml) publishes a build output, not the
  // committed admin/, so installing would guarantee a 404 — refuse before
  // writing. This is the Astro-repo case from dogfooding.
  it('refuses a repo with no _config.yml as not a Jekyll site', async () => {
    const r = await preflight(
      fakeClient({
        getTree: async () => ({
          files: [{ path: 'astro.config.mjs' }, { path: 'src/pages/index.astro' }],
          truncated: false,
        }),
      }),
      REPO,
      deps,
    );
    expect(r).toEqual({ ok: false, gate: 'not-jekyll' });
  });

  it('honours a /docs source root when looking for _config.yml', async () => {
    const r = await preflight(
      fakeClient({
        getPages: async () => ({
          html_url: 'https://octocat.github.io/blog/',
          https_enforced: true,
          source: { branch: 'main', path: '/docs' },
        }),
        // _config.yml at the repo root, not under docs/ — so from Pages' point
        // of view there is no Jekyll site at the source root.
        getTree: async () => ({ files: [{ path: '_config.yml' }], truncated: false }),
      }),
      REPO,
      deps,
    );
    expect(r).toEqual({ ok: false, gate: 'not-jekyll' });
  });

  // Can't prove _config.yml is absent from a partial tree (#18), so don't refuse
  // a possibly-fine site on incomplete evidence.
  it('skips the Jekyll check when the tree came back truncated', async () => {
    const r = await preflight(
      fakeClient({
        getTree: async () => ({ files: [{ path: 'assets/x.js' }], truncated: true }),
      }),
      REPO,
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.collision.kind).toBe('clean');
  });
});
