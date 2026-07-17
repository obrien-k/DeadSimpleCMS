// Where does Jekyll actually look? (#17) `_posts` is not a fixed path, and
// phase 1 assumed it was — `HEAD:_posts` in one hardcoded query. That fails
// silently: a missing directory is `object: null`, which is indistinguishable
// from an ordinary site with no drafts, so a /docs-served site got an empty
// post list and no explanation, and its publishes landed where Jekyll never
// reads.
//
// Everything the app touches is relative to ONE resolved root, resolved here,
// once, before anything is listed. Ordering is forced and not obvious:
// `collections_dir` lives IN `_config.yml`, but `_config.yml` lives at the
// source root, which is the thing being resolved. So:
//   GET /pages → source root → <root>/_config.yml → collections_dir.
//
// Measured against Jekyll 4.4.1 and the live API, not reasoned (docs/DESIGN.md):
// - `collections_dir: content` moves BOTH `_posts` and `_drafts` under it, and
//   root copies are ignored entirely.
// - `_config.yml`'s own `source:` key is inert on GitHub Pages, which overrides
//   it — so it is never read. The Pages API is the only authority on the root.
// - `GET /pages` needs authentication (a public repo with Pages 404s anonymously),
//   but a `Contents: read` token is enough — no Pages:read scope required.
import { parseYaml } from '../frontmatter/index.js';
import type { Entry, PagesInfo, PathQuery, PathResult, RepoInfo } from '../gh/index.js';

/** How the root was arrived at. The app has to be able to say when it assumed. */
export type LayoutBasis =
  | 'pages' // GitHub told us: a branch build's source.branch + source.path.
  | 'workflow' // Actions builds the site, so source.path is not in play. Root assumed.
  | 'no-pages' // Pages is off. Root assumed.
  | 'pages-unreadable'; // Private repo; the token cannot see /pages. Root assumed.

export interface Layout {
  /** The branch Pages builds. Not always the repo default — jekyll/jekyll builds from `gh-pages`. */
  branch: string;
  /** '' for the repo root, else e.g. 'docs'. No leading or trailing slash. */
  sourceRoot: string;
  // Plural because Jekyll reads `<root>/**/_posts` — every directory at any
  // depth, no config required (measured; see DESIGN.md). #17 resolves the root
  // only, so these hold exactly one entry today; the recursion fills them in
  // without moving any caller.
  postsDirs: string[];
  draftsDirs: string[];
  basis: LayoutBasis;
}

/** An entry plus the full path it was found at — so no caller rebuilds a path from a directory it had to know. */
export interface FoundFile {
  path: string;
  name: string;
  oid: string;
}

export interface Resolved {
  layout: Layout;
  // The listing rides along because it is the same query: resolving needs
  // <root>/_config.yml, and the speculative fetch asks for the candidate
  // `_posts`/`_drafts` in the same round trip. Separating them would cost a
  // third trip to re-fetch what we already hold.
  entries: { posts: FoundFile[]; drafts: FoundFile[] };
}

/** Row 4: no Jekyll site at the resolved root. Say so; never guess past it. */
export class LayoutError extends Error {
  constructor(readonly root: string) {
    super(`no Jekyll site found at ${root === '' ? 'the repository root' : root}`);
    this.name = 'LayoutError';
  }
}

export interface LayoutSource {
  getPages(): Promise<PagesInfo | null>;
  getRepo(): Promise<RepoInfo>;
  queryPaths(q: PathQuery): Promise<PathResult>;
}

/** "/" and "/docs/" both arrive from the API; '' and 'docs' are what paths need. */
const clean = (p: string): string => p.replace(/^\/+|\/+$/g, '');

const join = (...parts: string[]): string => parts.filter(Boolean).join('/');

export async function resolveLayout(gh: LayoutSource): Promise<Resolved> {
  // Parallel: two REST calls, one round trip. getRepo is needed for the
  // assumed branches and for `private`, which is the only thing that keeps the
  // "Pages is off" message from lying to a private-repo owner.
  const [pages, repo] = await Promise.all([gh.getPages(), gh.getRepo()]);

  let branch: string;
  let sourceRoot: string;
  let basis: LayoutBasis;

  if (pages && pages.build_type !== 'workflow' && pages.source) {
    branch = pages.source.branch;
    sourceRoot = clean(pages.source.path);
    basis = 'pages';
  } else if (pages) {
    // Actions decides the source in the workflow file, which we do not parse:
    // unbounded, and the schema is not ours. GitHub's starter Jekyll workflow
    // builds from the root, so root is the candidate — confirmed below by the
    // `_config.yml` this resolution needs anyway, never taken on faith.
    branch = repo.default_branch;
    sourceRoot = '';
    basis = 'workflow';
  } else {
    // 404 has two causes GitHub refuses to distinguish: Pages is off, or the
    // repo is private and the token lacks Pages:read. `private` separates them.
    branch = repo.default_branch;
    sourceRoot = '';
    basis = repo.private ? 'pages-unreadable' : 'no-pages';
  }

  const configPath = join(sourceRoot, '_config.yml');
  const postsPath = join(sourceRoot, '_posts');
  const draftsPath = join(sourceRoot, '_drafts');

  // Speculative: assume no collections_dir (the common case) and fetch the
  // config and the candidate directories together. When the guess holds, this
  // is the only content query.
  const probe = await gh.queryPaths({
    branch,
    dirs: [postsPath, draftsPath],
    files: [configPath],
  });

  const configText = probe.files.get(configPath) ?? null;
  const posts = probe.dirs.get(postsPath) ?? null;
  const drafts = probe.dirs.get(draftsPath) ?? null;

  // Evidence, not faith: either sighting confirms a Jekyll source. `_config.yml`
  // alone would be wrong as a gate — Jekyll builds happily without one, and
  // GitHub Pages supplies the defaults.
  if (configText === null && posts === null) throw new LayoutError(sourceRoot);

  const collectionsDir = readCollectionsDir(configText);
  const layout: Layout = {
    branch,
    sourceRoot,
    postsDirs: [postsPath],
    draftsDirs: [draftsPath],
    basis,
  };

  if (!collectionsDir) {
    return { layout, entries: { posts: collect(layout.postsDirs, probe), drafts: collect(layout.draftsDirs, probe) } };
  }

  // collections_dir moves both `_posts` and `_drafts` under it, and anything
  // left at the root is ignored by Jekyll — so the speculative entries are
  // discarded rather than merged. Rare enough to be worth a second query.
  const base = join(sourceRoot, collectionsDir);
  layout.postsDirs = [join(base, '_posts')];
  layout.draftsDirs = [join(base, '_drafts')];

  const moved = await gh.queryPaths({ branch, dirs: [...layout.postsDirs, ...layout.draftsDirs] });
  return {
    layout,
    entries: { posts: collect(layout.postsDirs, moved), drafts: collect(layout.draftsDirs, moved) },
  };
}

// Flattens dirs → files, stamping each with the path it was found at. Iterating
// the array is what lets the `**/_posts` recursion land inside this module
// without any caller changing.
function collect(dirs: string[], result: PathResult): FoundFile[] {
  return dirs.flatMap((dir) =>
    (result.dirs.get(dir) ?? []).map((e) => ({ path: join(dir, e.name), name: e.name, oid: e.oid })),
  );
}

function readCollectionsDir(configText: string | null): string {
  if (configText === null) return '';
  let config: Record<string, unknown>;
  try {
    config = parseYaml(configText);
  } catch {
    // A malformed _config.yml cannot build on GitHub either, so the site is
    // already broken and the finish line will say so. Falling back to Jekyll's
    // default (no collections_dir) beats refusing to open the CMS.
    return '';
  }
  const value = config.collections_dir;
  return typeof value === 'string' ? clean(value) : '';
}
