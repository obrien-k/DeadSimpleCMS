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
// `_posts` is only a NAME, and it is relocatable four ways (#17, #18). Measured
// against the live API and against BOTH Jekyll 3.10.0 — the version GitHub
// Pages actually runs (github-pages gem 232) — and 4.4.1, which an Actions
// build may pin. The two agree on everything relied on here (docs/DESIGN.md):
// - Pages' `source.path` moves the root (`/docs`), and `source.branch` moves
//   the branch — HEAD silently meant "the default branch", but jekyll/jekyll
//   builds from `gh-pages`.
// - `collections_dir: content` moves BOTH `_posts` and `_drafts` under it, and
//   root copies are ignored entirely.
// - Jekyll reads `_posts`/`_drafts` from EVERY directory at any depth, with no
//   config at all, and the subdirectory flows into the URL. So a single
//   `<base>/_posts` query is wrong even on a conventional site — see the fence
//   below for what bounds the walk.
// - `_config.yml`'s own `source:` key is inert on GitHub Pages, which overrides
//   it — so it is never read. The Pages API is the only authority on the root.
// - `GET /pages` needs authentication (a public repo with Pages 404s anonymously),
//   but a `Contents: read` token is enough — no Pages:read scope required.
import { parseYaml } from '../frontmatter/index.js';
import type { Entry, PagesInfo, PathQuery, PathResult, RepoInfo, TreeFile, TreeResult } from '../gh/index.js';

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
  // Every directory Jekyll reads posts/drafts from — `<base>/**/_posts`, at any
  // depth, no config required (measured; see DESIGN.md). Read sets: either may
  // be EMPTY (a site with no `_drafts/` anywhere is ordinary), so neither is a
  // write target. Sorted shallowest first, then alphabetically.
  postsDirs: string[];
  draftsDirs: string[];
  /** Where new content goes: `${writeBase}/_posts`, `${writeBase}/_drafts`. Always usable, even when the directory does not exist yet. */
  writeBase: string;
  basis: LayoutBasis;
  /** 'root-only' when the tree came back truncated, so posts outside the canonical directory could not be looked for (#18). */
  postsScan: 'recursive' | 'root-only';
}

/** An entry plus the full path it was found at — so no caller rebuilds a path from a directory it had to know. */
export interface FoundFile {
  path: string;
  name: string;
  oid: string;
}

export interface Resolved {
  layout: Layout;
  // The listing rides along because it is the same fetch: the tree read that
  // answers "where does Jekyll look" already carries every post in it.
  entries: { posts: FoundFile[]; drafts: FoundFile[] };
  // Everything Jekyll walks that is not in a `_posts`/`_drafts` directory:
  // pages and static files, already pruned by the fence. Exposed so #12 can
  // filter it for pages with no further requests — the same reasoning that put
  // `entries` here. Paths only: what counts as a page is #12's question.
  // Empty when postsScan is 'root-only' — the walk never completed.
  sourceFiles: FoundFile[];
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
  getTree(branch: string): Promise<TreeResult>;
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
  // Parallel: the tree read is repo-wide and does not depend on anything in the
  // config, so `collections_dir` only changes which paths get filtered — not
  // which are fetched. Two round trips, always, including on a collections_dir
  // site (#17 needed a third).
  const [cfgRes, tree] = await Promise.all([
    gh.queryPaths({ branch, files: [configPath] }),
    gh.getTree(branch),
  ]);

  const configText = cfgRes.files.get(configPath) ?? null;
  const config = safeParse(configText);
  const base = join(sourceRoot, readString(config.collections_dir));

  const layout: Layout = {
    branch,
    sourceRoot,
    postsDirs: [],
    draftsDirs: [],
    writeBase: base,
    basis,
    postsScan: tree.truncated ? 'root-only' : 'recursive',
  };

  if (tree.truncated) return resolveTruncated(gh, layout, base, configText);

  const fence = readFence(config, sourceRoot);
  const posts = collectMagic(tree.files, base, '_posts', fence);
  const drafts = collectMagic(tree.files, base, '_drafts', fence);

  // Evidence, not faith: either sighting confirms a Jekyll source. `_config.yml`
  // alone would be wrong as a gate — Jekyll builds happily without one, and
  // GitHub Pages supplies the defaults.
  if (configText === null && posts.dirs.length === 0) throw new LayoutError(base);

  layout.postsDirs = posts.dirs;
  layout.draftsDirs = drafts.dirs;
  layout.writeBase = pickWriteBase(base, posts.dirs);

  return {
    layout,
    entries: { posts: posts.files, drafts: drafts.files },
    sourceFiles: collectSource(tree.files, base, fence),
  };
}

// The tree came back partial, and GitHub says so but not where — so anything
// derived from it would be missing posts with no symptom, which is the failure
// this ticket exists to end. Degrade to exactly the pre-#18 behaviour (the
// canonical directories, read directly) and let the app say posts elsewhere
// cannot be found. Needs ~100k entries to reach; a site in /docs inside a
// monorepo is the realistic shape, since the tree call is repo-wide.
async function resolveTruncated(
  gh: LayoutSource,
  layout: Layout,
  base: string,
  configText: string | null,
): Promise<Resolved> {
  const postsPath = join(base, '_posts');
  const draftsPath = join(base, '_drafts');
  const r = await gh.queryPaths({ branch: layout.branch, dirs: [postsPath, draftsPath] });
  const posts = r.dirs.get(postsPath) ?? null;

  if (configText === null && posts === null) throw new LayoutError(base);

  layout.postsDirs = posts ? [postsPath] : [];
  layout.draftsDirs = r.dirs.get(draftsPath) ? [draftsPath] : [];
  return {
    layout,
    entries: { posts: stamp(postsPath, posts), drafts: stamp(draftsPath, r.dirs.get(draftsPath) ?? null) },
    // Nothing honest to offer #12: the walk never completed.
    sourceFiles: [],
  };
}

const stamp = (dir: string, entries: Entry[] | null): FoundFile[] =>
  (entries ?? []).map((e) => ({ path: join(dir, e.name), name: e.name, oid: e.oid }));

// ---------------------------------------------------------------------------
// Jekyll's prune fence. Measured against BOTH Jekyll 3.10.0 — what GitHub Pages
// actually runs (github-pages gem 232) — and 4.4.1, which is what an Actions
// build may pin. Every rule honoured here behaves identically on both.
//
// Deliberately NOT honoured: Jekyll's built-in default excludes. On 3.10 a user
// `exclude:` key REPLACES that list; on 4.x it is merged in — so the effective
// defaults depend on a Jekyll version we can only see for build_type: legacy.
// They name only node_modules, vendor/{bundle,cache,gems,ruby}, Gemfile,
// gemfiles, .sass-cache and .jekyll-cache: the dot-prefixed ones are pruned
// structurally anyway, and none of the rest ever holds a `_posts`. Replicating
// a version-dependent merge to protect a case that does not occur is a worse
// trade than the residual (see DESIGN.md).
//
// Also not honoured: glob patterns in `exclude:`. Matching them means
// reimplementing File.fnmatch — the kind of thing this project refuses to own.
interface Fence {
  /** Source-relative paths that re-open a `_`/`.` directory. Measured: `include: ["_included"]` makes `_included/_posts` live. */
  include: string[];
  /** Source-relative literal prefixes from the user's `exclude:`. Root-anchored: `node_modules` does NOT prune `blog/node_modules`. */
  exclude: string[];
}

const isGlob = (s: string) => /[*?[\]{}]/.test(s);

function readFence(config: Record<string, unknown>, sourceRoot: string): Fence {
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const abs = (p: string) => join(sourceRoot, clean(p));
  return {
    include: list(config.include).map(abs),
    exclude: list(config.exclude).filter((p) => !isGlob(p)).map(abs),
  };
}

/** True when Jekyll would descend into every directory on the way to this path. */
function walkable(dirs: string[], from: string, fence: Fence): boolean {
  let acc = from;
  for (const seg of dirs) {
    acc = join(acc, seg);
    const special = seg.startsWith('_') || seg.startsWith('.');
    if (special && !fence.include.includes(acc)) return false;
    if (fence.exclude.some((p) => acc === p || acc.startsWith(`${p}/`))) return false;
  }
  return true;
}

const under = (path: string, base: string): string | null =>
  base === '' ? path : path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;

// Files in a magic collection directory (`_posts`/`_drafts`) anywhere under
// base — measured: `blog/_posts/x.md` is a post on a stock config, at any
// depth, and the subdirectory flows into the post's URL. The magic segment
// itself is exempt from the `_` rule; Jekyll reads it explicitly rather than
// walking into it.
function collectMagic(
  files: TreeFile[],
  base: string,
  magic: string,
  fence: Fence,
): { dirs: string[]; files: FoundFile[] } {
  const found: FoundFile[] = [];
  const dirs = new Set<string>();
  for (const f of files) {
    const rel = under(f.path, base);
    if (rel === null) continue;
    const segs = rel.split('/');
    const name = segs.pop()!;
    if (segs.pop() !== magic) continue; // the magic dir must be the file's parent
    if (!walkable(segs, base, fence)) continue;
    const dir = join(base, ...segs, magic);
    dirs.add(dir);
    found.push({ path: f.path, name, oid: f.sha });
  }
  return { dirs: [...dirs].sort(byDepthThenName), files: found };
}

// Everything Jekyll walks that is NOT in a magic collection directory: pages
// and static files together. #12 filters this for front matter; deciding what a
// page IS stays that ticket's question, not this module's.
function collectSource(files: TreeFile[], base: string, fence: Fence): FoundFile[] {
  const out: FoundFile[] = [];
  for (const f of files) {
    const rel = under(f.path, base);
    if (rel === null) continue;
    const segs = rel.split('/');
    const name = segs.pop()!;
    if (name.startsWith('_') || name.startsWith('.')) continue;
    if (!walkable(segs, base, fence)) continue;
    out.push({ path: f.path, name, oid: f.sha });
  }
  return out;
}

const byDepthThenName = (a: string, b: string) =>
  a.split('/').length - b.split('/').length || a.localeCompare(b);

// Reads want everywhere Jekyll looks; a write wants one answer that always
// exists. Prefer the canonical `<base>/_posts`. Failing that, never invent a
// directory a site with an established convention does not use — a site whose
// only posts live in `blog/_posts` should get its next post there too, or it
// gets a URL shape none of its other posts have.
function pickWriteBase(base: string, postsDirs: string[]): string {
  if (postsDirs.length === 0 || postsDirs.includes(join(base, '_posts'))) return base;
  const first = postsDirs[0]!; // already sorted shallowest, then alphabetically
  return first.slice(0, Math.max(first.lastIndexOf('/'), 0));
}

function safeParse(configText: string | null): Record<string, unknown> {
  if (configText === null) return {};
  try {
    return parseYaml(configText);
  } catch {
    // A malformed _config.yml cannot build on GitHub either, so the site is
    // already broken and the finish line will say so. Falling back to Jekyll's
    // defaults beats refusing to open the CMS.
    return {};
  }
}

const readString = (v: unknown): string => (typeof v === 'string' ? clean(v) : '');
