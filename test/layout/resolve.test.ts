import { describe, expect, it } from 'vitest';
import { LayoutError, resolveLayout, type LayoutSource } from '../../src/layout/index.js';
import type { PagesInfo, PathQuery, PathResult, RepoInfo } from '../../src/gh/index.js';

// A repo as trees and files: the fake answers queryPaths from it, so a test
// says "here is the site" rather than "here is what the query returns".
interface Site {
  pages?: PagesInfo | null;
  repo?: Partial<RepoInfo>;
  /** path -> file names. A path absent here is absent on the branch (`null`). */
  dirs?: Record<string, string[]>;
  files?: Record<string, string>;
}

function fakeGh(site: Site) {
  const queries: PathQuery[] = [];
  const gh: LayoutSource = {
    getPages: async () => ('pages' in site ? site.pages! : null),
    getRepo: async () => ({ default_branch: 'main', private: false, ...site.repo }),
    queryPaths: async (q) => {
      queries.push(q);
      const out: PathResult = { dirs: new Map(), files: new Map() };
      for (const d of q.dirs ?? []) {
        const names = site.dirs?.[d];
        out.dirs.set(d, names ? names.map((name) => ({ name, oid: `oid-${name}` })) : null);
      }
      for (const f of q.files ?? []) out.files.set(f, site.files?.[f] ?? null);
      return out;
    },
  };
  return { gh, queries };
}

const CONVENTIONAL: Site = {
  pages: { html_url: 'https://x/', status: 'built', build_type: 'legacy', source: { branch: 'main', path: '/' } },
  dirs: { _posts: ['2026-07-01-a.md'], _drafts: ['wip.md'] },
  files: { '_config.yml': 'title: Site\n' },
};

describe('resolveLayout', () => {
  it('a conventional site resolves to the repo root', async () => {
    const { gh, queries } = fakeGh(CONVENTIONAL);
    const { layout, entries } = await resolveLayout(gh);

    expect(layout).toEqual({
      branch: 'main',
      sourceRoot: '',
      postsDirs: ['_posts'],
      draftsDirs: ['_drafts'],
      basis: 'pages',
    });
    expect(entries.posts).toEqual([
      { path: '_posts/2026-07-01-a.md', name: '2026-07-01-a.md', oid: 'oid-2026-07-01-a.md' },
    ]);
    // The speculation held: config and both directories in one query.
    expect(queries.length).toBe(1);
  });

  // The headline #17 case: "Deploy from a branch" with the folder set to /docs.
  // A checkbox in repo settings, and phase 1's HEAD:_posts returned null for it
  // — an empty post list with no explanation.
  it('a /docs-served site reads and publishes under docs/', async () => {
    const { gh } = fakeGh({
      pages: { html_url: 'https://x/', status: 'built', build_type: 'legacy', source: { branch: 'main', path: '/docs' } },
      dirs: { 'docs/_posts': ['2026-07-01-a.md'] },
      files: { 'docs/_config.yml': 'title: Site\n' },
    });
    const { layout, entries } = await resolveLayout(gh);

    expect(layout.sourceRoot).toBe('docs');
    expect(layout.postsDirs).toEqual(['docs/_posts']);
    expect(layout.draftsDirs).toEqual(['docs/_drafts']);
    expect(entries.posts[0]!.path).toBe('docs/_posts/2026-07-01-a.md');
  });

  // jekyll/jekyll builds from gh-pages while its default branch is not gh-pages.
  // Measured on the live API, not imagined.
  it('follows the branch Pages builds, not the repo default', async () => {
    const { gh, queries } = fakeGh({
      pages: { html_url: 'https://x/', status: 'built', build_type: 'legacy', source: { branch: 'gh-pages', path: '/' } },
      repo: { default_branch: 'main' },
      dirs: { _posts: [] },
      files: { '_config.yml': '' },
    });
    const { layout } = await resolveLayout(gh);

    expect(layout.branch).toBe('gh-pages');
    expect(queries[0]!.branch).toBe('gh-pages');
  });

  // Measured against Jekyll 4.4.1: collections_dir moves BOTH _posts and
  // _drafts, and anything left at the root is ignored entirely — so root
  // entries are discarded, never merged.
  it('collections_dir moves posts and drafts, and the root copies are ignored', async () => {
    const { gh, queries } = fakeGh({
      pages: { html_url: 'https://x/', status: 'built', build_type: 'legacy', source: { branch: 'main', path: '/' } },
      dirs: {
        _posts: ['2026-01-01-ignored.md'],
        'content/_posts': ['2026-02-02-moved.md'],
        'content/_drafts': ['moved-draft.md'],
      },
      files: { '_config.yml': 'collections_dir: content\n' },
    });
    const { layout, entries } = await resolveLayout(gh);

    expect(layout.postsDirs).toEqual(['content/_posts']);
    expect(layout.draftsDirs).toEqual(['content/_drafts']);
    expect(entries.posts.map((p) => p.name)).toEqual(['2026-02-02-moved.md']);
    expect(entries.drafts.map((d) => d.name)).toEqual(['moved-draft.md']);
    // The rare case costs the extra query the speculation gambled on avoiding.
    expect(queries.length).toBe(2);
  });

  it('composes collections_dir with a /docs root', async () => {
    const { gh } = fakeGh({
      pages: { html_url: 'https://x/', status: 'built', build_type: 'legacy', source: { branch: 'main', path: '/docs' } },
      dirs: { 'docs/content/_posts': ['2026-02-02-a.md'] },
      files: { 'docs/_config.yml': 'collections_dir: content\n' },
    });
    const { layout } = await resolveLayout(gh);
    expect(layout.postsDirs).toEqual(['docs/content/_posts']);
  });

  // GitHub Pages overrides `source:` and does not let a site set it, so the key
  // is inert and reading it would resolve against a path Jekyll never uses.
  it('ignores a source: key in _config.yml — Pages overrides it', async () => {
    const { gh } = fakeGh({
      ...CONVENTIONAL,
      files: { '_config.yml': 'source: somewhere-else\n' },
    });
    const { layout } = await resolveLayout(gh);
    expect(layout.sourceRoot).toBe('');
    expect(layout.postsDirs).toEqual(['_posts']);
  });

  describe('when GitHub cannot say where the source is', () => {
    it('an Actions-built site assumes the root and says so', async () => {
      const { gh } = fakeGh({
        pages: { html_url: 'https://x/', status: 'built', build_type: 'workflow', source: { branch: 'main', path: '/docs' } },
        dirs: { _posts: ['2026-07-01-a.md'] },
        files: { '_config.yml': '' },
      });
      const { layout } = await resolveLayout(gh);
      // source.path says /docs, but a workflow decides the source, so that
      // setting is not in play and must not be trusted.
      expect(layout.sourceRoot).toBe('');
      expect(layout.basis).toBe('workflow');
    });

    it('Pages switched off assumes the root, on the default branch', async () => {
      const { gh } = fakeGh({
        pages: null,
        repo: { default_branch: 'trunk', private: false },
        files: { '_config.yml': '' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout).toMatchObject({ branch: 'trunk', sourceRoot: '', basis: 'no-pages' });
    });

    it('a private repo is "cannot read Pages", never "Pages is off"', async () => {
      const { gh } = fakeGh({ pages: null, repo: { private: true }, files: { '_config.yml': '' } });
      const { layout } = await resolveLayout(gh);
      expect(layout.basis).toBe('pages-unreadable');
    });
  });

  describe('the evidence test', () => {
    // Jekyll builds happily with no _config.yml — GitHub Pages supplies the
    // defaults — so the config alone cannot be the gate.
    it('accepts a site with _posts but no _config.yml', async () => {
      const { gh } = fakeGh({ pages: null, dirs: { _posts: ['2026-07-01-a.md'] } });
      const { layout } = await resolveLayout(gh);
      expect(layout.sourceRoot).toBe('');
    });

    it('accepts a site with _config.yml but no posts yet', async () => {
      const { gh } = fakeGh({ pages: null, files: { '_config.yml': 'title: New\n' } });
      const { entries } = await resolveLayout(gh);
      expect(entries.posts).toEqual([]);
    });

    // Row 4. Guessing on from here writes posts where Jekyll never reads, which
    // is the failure #17 exists to end — so the app stops and says so.
    it('refuses to guess when the root holds no Jekyll site', async () => {
      const { gh } = fakeGh({
        pages: { html_url: 'https://x/', status: 'built', build_type: 'legacy', source: { branch: 'main', path: '/docs' } },
      });
      await expect(resolveLayout(gh)).rejects.toBeInstanceOf(LayoutError);
      await expect(resolveLayout(gh)).rejects.toMatchObject({ root: 'docs' });
    });
  });

  it('a malformed _config.yml falls back to Jekyll defaults rather than locking the writer out', async () => {
    const { gh } = fakeGh({
      ...CONVENTIONAL,
      files: { '_config.yml': 'collections_dir: [unclosed\n' },
    });
    const { layout } = await resolveLayout(gh);
    expect(layout.postsDirs).toEqual(['_posts']);
  });
});
