// The install-time gate sequence (#29). Ordered by dependency, each gate a hard
// stop with its own message: reachability → Pages enabled → Enforce HTTPS →
// #8 collision. HTTPS sits after Pages on purpose — https_enforced is a field
// of an enabled Pages site, so "no Pages" is strictly the earlier failure (this
// is the one place the real order differs from the prototype's cosmetic one).
import type { Collision } from './collision.js';
import { classifyCollision } from './collision.js';

export interface PagesLike {
  html_url: string;
  https_enforced?: boolean;
  source?: { branch: string; path: string };
  /** 'workflow' = Actions builds the site, so source path is not the served layout (#17). */
  build_type?: 'legacy' | 'workflow' | null;
}

// The slice of the gh client the preflight needs. Structural, so tests pass a
// fake and the real GhClient satisfies it without importing it here.
export interface PreflightClient {
  probeWrite(): Promise<boolean>;
  getPages(): Promise<PagesLike | null>;
  getDefaultBranch(): Promise<string>;
  getTree(branch: string): Promise<{ files: { path: string }[]; truncated: boolean }>;
  readFile(path: string): Promise<{ text: string; sha: string }>;
  tokenExpiry(): Date | null;
}

export interface PreflightDeps {
  /** dscms:repo from admin/index.html — DOMParser in the browser, a stub in tests. */
  extractRepoMeta(html: string): string | null;
}

export type PreflightBlock = 'unreachable' | 'no-pages' | 'insecure' | 'not-jekyll';

export type Preflight =
  | { ok: false; gate: PreflightBlock }
  | {
      ok: true;
      collision: Collision;
      /** Branch the site builds from — where admin/ is written, not always the default (#17). */
      branch: string;
      /** Repo-path prefix admin/ lives under, honouring a /docs source root. */
      adminPrefix: string;
      /** Where the installed admin page will answer. */
      liveUrl: string;
      expiry: Date | null;
      /** The tree came back partial (#18) — collision may have missed an entry. */
      truncated: boolean;
      /** Surfaced so the UI can warn that a workflow build may not serve admin/. */
      buildType: 'legacy' | 'workflow' | null;
    };

const ADMIN = 'admin/';

/** "/docs" → "docs/admin/", "/" or undefined → "admin/". */
export function adminPrefixFor(sourcePath: string | undefined): string {
  const p = (sourcePath ?? '/').replace(/^\/+|\/+$/g, '');
  return p ? `${p}/${ADMIN}` : ADMIN;
}

export async function preflight(
  client: PreflightClient,
  targetRepo: string,
  deps: PreflightDeps,
): Promise<Preflight> {
  // 1. Reachability — the write probe proves the token can actually publish
  //    here. Wrong-repo / unscoped / missing-permission all 404 alike (#7), so
  //    this is one honest yes/no, not three guesses.
  if (!(await client.probeWrite())) return { ok: false, gate: 'unreachable' };

  // 2. Pages enabled — no Pages, no live URL, and the live URL is the promise.
  //    A null response (off, or unreadable on a private repo) is the same block.
  const pages = await client.getPages();
  if (!pages) return { ok: false, gate: 'no-pages' };

  // 3. Enforce HTTPS — the admin page carries a write token; over plain HTTP it
  //    can be MITM'd and the token stolen (#3). false is the default a fresh
  //    custom domain lands in while its cert provisions, so it is a real gate.
  if (pages.https_enforced === false) return { ok: false, gate: 'insecure' };

  // 4. Collision (#8), scanned on the branch the site builds from, under the
  //    real source root so admin/ is found where it will actually land.
  const branch = pages.source?.branch ?? (await client.getDefaultBranch());
  const adminPrefix = adminPrefixFor(pages.source?.path);
  const parentLen = adminPrefix.length - ADMIN.length;
  const tree = await client.getTree(branch);

  // 5. Jekyll-site check. The whole model — commit admin/ and let Pages serve
  //    it, read posts from _config.yml + front matter — assumes a Jekyll site
  //    built from the branch. A repo with no _config.yml at the source root is
  //    something else (an Astro/Next build, say); its Pages publishes a build
  //    output, not the committed admin/, so the editor is a guaranteed 404.
  //    Refuse before writing rather than install into that. Skipped on a
  //    truncated tree (#18): absence can't be proven when the read was partial.
  const rootPrefix = adminPrefix.slice(0, parentLen);
  if (!tree.truncated && !tree.files.some((f) => f.path === `${rootPrefix}_config.yml`)) {
    return { ok: false, gate: 'not-jekyll' };
  }

  // Re-root every admin/-side path to "admin/…" so the classifier stays
  // source-root-agnostic.
  const adminEntries = tree.files
    .map((f) => f.path)
    .filter((p) => p.startsWith(adminPrefix))
    .map((p) => p.slice(parentLen));

  let indexRepoMeta: string | null = null;
  if (adminEntries.includes(`${ADMIN}index.html`)) {
    const { text } = await client.readFile(`${adminPrefix}index.html`);
    indexRepoMeta = deps.extractRepoMeta(text);
  }

  const collision = classifyCollision({ adminEntries, indexRepoMeta, targetRepo });

  return {
    ok: true,
    collision,
    branch,
    adminPrefix,
    liveUrl: `${pages.html_url.replace(/\/$/, '')}/admin/`,
    expiry: client.tokenExpiry(),
    truncated: tree.truncated,
    buildType: pages.build_type ?? null,
  };
}
