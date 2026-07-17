import { describe, expect, it } from 'vitest';
import { LayoutError, resolveLayout, type LayoutSource } from '../../src/layout/index.js';
import type { PagesInfo, PathQuery, PathResult, RepoInfo, TreeResult } from '../../src/gh/index.js';

// A repo as a list of paths: a test says "here is the site" rather than "here is
// what the query returns". Expectations below are Jekyll's, measured — run
// test/oracle/jekyll-layout-oracle.rb to re-derive them against a real build.
interface Site {
  pages?: PagesInfo | null;
  repo?: Partial<RepoInfo>;
  /** Every blob path in the repo. */
  paths?: string[];
  files?: Record<string, string>;
  truncated?: boolean;
  /** Answers the targeted fallback query used when the tree is truncated. */
  dirs?: Record<string, string[]>;
}

function fakeGh(site: Site) {
  const calls: string[] = [];
  const gh: LayoutSource = {
    getPages: async () => ('pages' in site ? site.pages! : null),
    getRepo: async () => ({ default_branch: 'main', private: false, ...site.repo }),
    getTree: async (branch): Promise<TreeResult> => {
      calls.push(`getTree:${branch}`);
      return {
        files: (site.paths ?? []).map((path) => ({ path, sha: `oid-${path}` })),
        truncated: site.truncated === true,
      };
    },
    queryPaths: async (q) => {
      calls.push(`queryPaths:${[...(q.dirs ?? []), ...(q.files ?? [])].join(',')}`);
      const out: PathResult = { dirs: new Map(), files: new Map() };
      for (const d of q.dirs ?? []) {
        const names = site.dirs?.[d];
        out.dirs.set(d, names ? names.map((name) => ({ name, oid: `oid-${d}/${name}` })) : null);
      }
      for (const f of q.files ?? []) out.files.set(f, site.files?.[f] ?? null);
      return out;
    },
  };
  return { gh, calls };
}

const legacy = (branch = 'main', path = '/'): PagesInfo => ({
  html_url: 'https://x/',
  status: 'built',
  build_type: 'legacy',
  source: { branch, path },
});

const names = (fs: { name: string }[]) => fs.map((f) => f.name).sort();

describe('resolveLayout', () => {
  it('a conventional site resolves to the repo root, in two round trips', async () => {
    const { gh, calls } = fakeGh({
      pages: legacy(),
      paths: ['_config.yml', '_posts/2026-07-01-a.md', '_drafts/wip.md'],
      files: { '_config.yml': 'title: Site\n' },
    });
    const { layout, entries } = await resolveLayout(gh);

    expect(layout).toEqual({
      branch: 'main',
      sourceRoot: '',
      postsDirs: ['_posts'],
      draftsDirs: ['_drafts'],
      writeBase: '',
      basis: 'pages',
      postsScan: 'recursive',
      pageExts: ['markdown', 'mkdown', 'mkdn', 'mkd', 'md', 'html', 'htm'],
    });
    expect(entries.posts).toEqual([
      { path: '_posts/2026-07-01-a.md', name: '2026-07-01-a.md', oid: 'oid-_posts/2026-07-01-a.md' },
    ]);
    // The tree read does not depend on the config, so both go at once. No third
    // trip exists for collections_dir to need (#17 gambled a speculative query).
    expect(calls).toEqual(['queryPaths:_config.yml', 'getTree:main']);
  });

  // THE #18 bug: stock Jekyll, no config at all, and these are real posts whose
  // subdirectory flows into the URL. `<base>/_posts` alone silently half-lists.
  it('reads _posts from every directory at any depth', async () => {
    const { gh } = fakeGh({
      pages: legacy(),
      paths: [
        '_config.yml',
        '_posts/2026-01-01-root.md',
        'blog/_posts/2026-01-02-nested.md',
        'deep/nested/very/_posts/2026-01-03-deep.md',
        'deep/nested/very/_drafts/deep-draft.md',
      ],
      files: { '_config.yml': '' },
    });
    const { layout, entries } = await resolveLayout(gh);

    expect(layout.postsDirs).toEqual(['_posts', 'blog/_posts', 'deep/nested/very/_posts']);
    expect(layout.draftsDirs).toEqual(['deep/nested/very/_drafts']);
    expect(names(entries.posts)).toEqual([
      '2026-01-01-root.md',
      '2026-01-02-nested.md',
      '2026-01-03-deep.md',
    ]);
    expect(entries.drafts[0]!.path).toBe('deep/nested/very/_drafts/deep-draft.md');
  });

  it('a /docs-served site reads and publishes under docs/', async () => {
    const { gh } = fakeGh({
      pages: legacy('main', '/docs'),
      paths: ['docs/_config.yml', 'docs/_posts/2026-07-01-a.md', '_posts/2026-01-01-outside.md'],
      files: { 'docs/_config.yml': 'title: Site\n' },
    });
    const { layout, entries } = await resolveLayout(gh);

    expect(layout.sourceRoot).toBe('docs');
    expect(layout.postsDirs).toEqual(['docs/_posts']);
    expect(layout.writeBase).toBe('docs');
    // A _posts OUTSIDE the source root is not part of this site at all.
    expect(entries.posts.map((p) => p.path)).toEqual(['docs/_posts/2026-07-01-a.md']);
  });

  it('follows the branch Pages builds, not the repo default', async () => {
    const { gh, calls } = fakeGh({
      pages: legacy('gh-pages', '/'),
      repo: { default_branch: 'master' },
      paths: ['_config.yml'],
      files: { '_config.yml': '' },
    });
    const { layout } = await resolveLayout(gh);
    expect(layout.branch).toBe('gh-pages');
    expect(calls).toContain('getTree:gh-pages');
  });

  it('collections_dir moves both kinds, and the recursion composes under it', async () => {
    const { gh, calls } = fakeGh({
      pages: legacy(),
      paths: [
        '_config.yml',
        '_posts/2026-01-01-ignored.md',
        '_drafts/ignored-draft.md',
        'content/_posts/2026-02-02-moved.md',
        'content/_drafts/moved-draft.md',
        'content/blog/_posts/2026-02-03-nested.md',
      ],
      files: { '_config.yml': 'collections_dir: content\n' },
    });
    const { layout, entries } = await resolveLayout(gh);

    expect(layout.postsDirs).toEqual(['content/_posts', 'content/blog/_posts']);
    expect(layout.draftsDirs).toEqual(['content/_drafts']);
    expect(layout.writeBase).toBe('content');
    // Root copies are ignored ENTIRELY by Jekyll — not merged in.
    expect(names(entries.posts)).toEqual(['2026-02-02-moved.md', '2026-02-03-nested.md']);
    expect(names(entries.drafts)).toEqual(['moved-draft.md']);
    // Still two trips: the tree is repo-wide, so collections_dir only re-filters.
    expect(calls).toEqual(['queryPaths:_config.yml', 'getTree:main']);
  });

  describe('the fence', () => {
    it('prunes _ and . directories, but not the magic _posts segment itself', async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: [
          '_config.yml',
          '_posts/2026-01-01-root.md',
          '_underscore/_posts/2026-01-02-us.md',
          '.hidden/_posts/2026-01-03-hid.md',
          '.git/_posts/2026-01-04-git.md',
        ],
        files: { '_config.yml': '' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout.postsDirs).toEqual(['_posts']);
    });

    it('include: re-opens an underscore directory', async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: ['_config.yml', '_included/_posts/2026-01-04-inc.md'],
        files: { '_config.yml': 'include:\n  - "_included"\n' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout.postsDirs).toEqual(['_included/_posts']);
    });

    it("honours the user's literal exclude: entries", async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: ['_config.yml', '_posts/2026-01-01-a.md', 'archive/_posts/2026-01-02-old.md'],
        files: { '_config.yml': 'exclude:\n  - archive\n' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout.postsDirs).toEqual(['_posts']);
    });

    // Measured on both 3.10 and 4.4.1: exclude patterns are root-anchored, so a
    // bare `node_modules` does NOT prune a nested one — Jekyll reads it.
    it('treats exclude as root-anchored: a nested match is still read', async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: ['_config.yml', 'blog/node_modules/_posts/2026-01-02-nested.md'],
        files: { '_config.yml': 'exclude:\n  - node_modules\n' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout.postsDirs).toEqual(['blog/node_modules/_posts']);
    });

    // Jekyll's built-in defaults are deliberately not replicated: 3.10 REPLACES
    // them when the user sets exclude:, 4.x merges them, and we cannot see which
    // Jekyll a workflow site pins. They never name a directory holding posts.
    it('does not apply Jekyll built-in default excludes', async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: ['_config.yml', 'node_modules/_posts/2026-01-02-nm.md'],
        files: { '_config.yml': '' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout.postsDirs).toEqual(['node_modules/_posts']);
    });

    // Matching them means reimplementing File.fnmatch — rejected. The residual
    // is phantom posts, documented in DESIGN.md.
    it('ignores glob patterns in exclude: rather than half-matching them', async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: ['_config.yml', 'glob-thing/_posts/2026-01-05-g.md'],
        files: { '_config.yml': 'exclude:\n  - "glob-*"\n' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout.postsDirs).toEqual(['glob-thing/_posts']);
    });
  });

  describe('writeBase', () => {
    it('is the canonical base when <base>/_posts exists', async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: ['_config.yml', '_posts/2026-01-01-a.md', 'blog/_posts/2026-01-02-b.md'],
        files: { '_config.yml': '' },
      });
      expect((await resolveLayout(gh)).layout.writeBase).toBe('');
    });

    // Never invent a directory a site with an established convention does not
    // use: a site whose only posts live in blog/ should get its next post there,
    // or it gets a URL shape none of its other posts have.
    it('follows the site when the canonical directory does not exist', async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: ['_config.yml', 'notes/_posts/2026-01-02-b.md', 'blog/_posts/2026-01-01-a.md'],
        files: { '_config.yml': '' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout.postsDirs).toEqual(['blog/_posts', 'notes/_posts']);
      expect(layout.writeBase).toBe('blog');
    });

    it('falls back to the canonical base when the site has no posts at all', async () => {
      const { gh } = fakeGh({ pages: legacy(), paths: ['_config.yml'], files: { '_config.yml': 'title: New\n' } });
      const { layout } = await resolveLayout(gh);
      expect(layout.postsDirs).toEqual([]);
      expect(layout.draftsDirs).toEqual([]);
      expect(layout.writeBase).toBe('');
    });
  });

  describe('sourceFiles (handed to #12 for page discovery)', () => {
    it('is everything walked that is not in a magic directory', async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: [
          '_config.yml',
          'about.md',
          'contact/index.md',
          'assets/logo.png',
          '_posts/2026-01-01-a.md',
          '_drafts/wip.md',
          '_layouts/default.html',
          '.github/workflows/ci.yml',
        ],
        files: { '_config.yml': '' },
      });
      const { sourceFiles } = await resolveLayout(gh);
      expect(sourceFiles.map((f) => f.path).sort()).toEqual([
        'about.md',
        'assets/logo.png',
        'contact/index.md',
      ]);
    });
  });

  // Which extensions can be a page (#12). Jekyll's real rule is front matter
  // alone, but a site that renames markdown_ext stops rendering .md — so the
  // default is measured (identical on 3.10 and 4.4.1), never assumed.
  describe('pageExts', () => {
    it('defaults to Jekyll’s markdown_ext plus html/htm', async () => {
      const { gh } = fakeGh({ pages: legacy(), paths: ['_config.yml'], files: { '_config.yml': '' } });
      const { layout } = await resolveLayout(gh);
      expect(layout.pageExts).toEqual(['markdown', 'mkdown', 'mkdn', 'mkd', 'md', 'html', 'htm']);
    });

    it('honours a site that redefines markdown_ext', async () => {
      const { gh } = fakeGh({
        pages: legacy(),
        paths: ['_config.yml'],
        files: { '_config.yml': 'markdown_ext: "md,textile"\n' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout.pageExts).toEqual(['md', 'textile', 'html', 'htm']);
    });
  });

  describe('when GitHub cannot say where the source is', () => {
    it('an Actions-built site assumes the root and says so', async () => {
      const { gh } = fakeGh({
        pages: { ...legacy('main', '/docs'), build_type: 'workflow' },
        paths: ['_config.yml', '_posts/2026-07-01-a.md'],
        files: { '_config.yml': '' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout.sourceRoot).toBe('');
      expect(layout.basis).toBe('workflow');
    });

    it('Pages switched off assumes the root, on the default branch', async () => {
      const { gh } = fakeGh({
        pages: null,
        repo: { default_branch: 'trunk' },
        paths: ['_config.yml'],
        files: { '_config.yml': '' },
      });
      const { layout } = await resolveLayout(gh);
      expect(layout).toMatchObject({ branch: 'trunk', sourceRoot: '', basis: 'no-pages' });
    });

    it('a private repo is "cannot read Pages", never "Pages is off"', async () => {
      const { gh } = fakeGh({
        pages: null,
        repo: { private: true },
        paths: ['_config.yml'],
        files: { '_config.yml': '' },
      });
      expect((await resolveLayout(gh)).layout.basis).toBe('pages-unreadable');
    });
  });

  describe('a truncated tree', () => {
    // GitHub returns a PARTIAL tree and says only that it did, not what it cut.
    // Deriving anything from it would ship omission with no symptom.
    it('falls back to the canonical directories and reports the degrade', async () => {
      const { gh, calls } = fakeGh({
        pages: legacy(),
        truncated: true,
        paths: ['_config.yml'], // partial: the walk cannot be trusted
        files: { '_config.yml': '' },
        dirs: { _posts: ['2026-07-01-a.md'], _drafts: ['wip.md'] },
      });
      const { layout, entries, sourceFiles } = await resolveLayout(gh);

      expect(layout.postsScan).toBe('root-only');
      expect(layout.postsDirs).toEqual(['_posts']);
      expect(entries.posts[0]!.path).toBe('_posts/2026-07-01-a.md');
      expect(entries.drafts[0]!.path).toBe('_drafts/wip.md');
      // Nothing honest to give #12 — the walk never completed.
      expect(sourceFiles).toEqual([]);
      expect(calls).toContain('queryPaths:_posts,_drafts');
    });

    it('still refuses when the fallback finds no Jekyll site either', async () => {
      const { gh } = fakeGh({ pages: legacy('main', '/docs'), truncated: true, paths: [] });
      await expect(resolveLayout(gh)).rejects.toBeInstanceOf(LayoutError);
    });
  });

  describe('the evidence test', () => {
    it('accepts a site with _posts but no _config.yml', async () => {
      const { gh } = fakeGh({ pages: null, paths: ['_posts/2026-07-01-a.md'] });
      expect((await resolveLayout(gh)).layout.postsDirs).toEqual(['_posts']);
    });

    it('accepts a site with _config.yml but no posts yet', async () => {
      const { gh } = fakeGh({ pages: null, paths: ['_config.yml'], files: { '_config.yml': 'title: New\n' } });
      expect((await resolveLayout(gh)).entries.posts).toEqual([]);
    });

    it('refuses to guess when the root holds no Jekyll site', async () => {
      const { gh } = fakeGh({ pages: legacy('main', '/docs'), paths: ['README.md', '_posts/x.md'] });
      await expect(resolveLayout(gh)).rejects.toMatchObject({ root: 'docs' });
    });
  });

  it('a malformed _config.yml falls back to defaults rather than locking the writer out', async () => {
    const { gh } = fakeGh({
      pages: legacy(),
      paths: ['_config.yml', '_posts/2026-07-01-a.md'],
      files: { '_config.yml': 'collections_dir: [unclosed\n' },
    });
    expect((await resolveLayout(gh)).layout.postsDirs).toEqual(['_posts']);
  });
});
