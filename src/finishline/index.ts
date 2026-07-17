// The finish line (DESIGN.md "Publish = the finish line"): after a publish
// commit, walk the user from "Publishing…" to a verified live URL — or to an
// honest explanation of why there isn't one. Prototype-verified flow:
// - "No Pages configured" is one GET, categorically distinct from a slow build.
// - Track the build via the Deployments API (stable across both build types),
//   never /actions/runs.
// - The sitemap is authoritative about Jekyll, not about reality: it inherits
//   the user's baseurl mistake, so every <loc> is cross-checked against the
//   deployment's environment_url (GitHub stating the site root).
// - A green build with the post absent from the sitemap means Jekyll
//   deliberately skipped it; the local front matter says why, no API call.
import type { BuildState, Deployment, DeploymentStatus, PagesInfo, RepoInfo } from '../gh/index.js';

// What the raw build log blamed, once (#9). The check-run annotation is
// truncated at 4096 chars and Jekyll's debug log fills that before the error,
// so the job log is the only complete source — and it carries ANSI colour and
// per-line timestamps the parser must see through. Only a Liquid *Exception*
// stops the build; a Warning does not, and blaming one would be a false
// positive. Non-Liquid errors (a hand-edited YAML break) fall through to null,
// because they are not reachable through the CMS's own writes.
export interface BuildCause {
  /** Repo-relative, with the `/github/workspace/` build root stripped. */
  file: string;
  /** The line inside the file, when Jekyll names one. */
  line?: number;
  /** Jekyll's own message, e.g. "Liquid syntax error (line 2): 'if' tag was never closed". */
  problem: string;
}

export function parseBuildFailure(log: string): BuildCause | null {
  const clean = log.replace(/\x1b\[[0-9;]*m/g, '');
  const m = clean.match(/Liquid Exception:\s*(.+?)\s+in\s+(?:\/github\/workspace\/)?(\S+)/);
  if (!m) return null;
  const problem = m[1]!.trim();
  const file = m[2]!.trim();
  const line = problem.match(/\(line (\d+)\)/);
  return line ? { file, line: Number(line[1]), problem } : { file, problem };
}

export type FinishLineEvent =
  | { kind: 'no-pages' }
  | { kind: 'pages-unreadable' }
  | { kind: 'publishing' }
  | { kind: 'building'; state: string }
  // A red build (#9). `cause` is present only when the log named a file; `mine`
  // says whether that file is the one just published — the gate on blaming the
  // user. No cause, or a cause that isn't theirs, both fall to the honest floor.
  | { kind: 'build-failed'; cause?: { file: string; line?: number; problem: string; mine: boolean } }
  | { kind: 'live'; url: string }
  | { kind: 'live-unverified'; url: string }
  | { kind: 'skipped'; reason: 'future-dated' | 'unpublished' }
  | { kind: 'baseurl-misconfigured'; sitemapUrl: string; siteRoot: string }
  | { kind: 'not-in-sitemap'; siteRoot: string }
  | { kind: 'built-no-sitemap'; siteRoot: string }
  | { kind: 'timeout' };

export interface TrackDeps {
  gh: {
    getPages(): Promise<PagesInfo | null>;
    getRepo(): Promise<RepoInfo>;
    getBuildState(sha: string): Promise<BuildState>;
    getBuildLog(sha: string): Promise<string | null>;
    getDeployment(sha: string): Promise<Deployment | null>;
    getDeploymentStatuses(id: number): Promise<DeploymentStatus[]>;
  };
  /** Fetch used against the live site (sitemap + liveness probes). */
  fetchSite: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface TrackTarget {
  sha: string;
  slug: string;
  /** The published file's repo-relative path — the key that attributes a build failure to this post (#9). */
  path?: string;
  /** The front matter the app just wrote — the local answer to "why skipped?". */
  front: Record<string, unknown>;
}

export interface TrackOptions {
  pollMs?: number;
  maxDeploymentPolls?: number;
  maxStatusPolls?: number;
  sitemapRetries?: number;
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)].map((m) => m[1]!);
}

function matchesSlug(loc: string, slug: string): boolean {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`/${escaped}(\\.html?|/|$)`).test(loc);
}

// Jekyll's `future: false` default silently drops posts dated past the build
// clock — routine, not exotic (UTC vs local bit the prototype built to test
// it). The app wrote the date, so it can tell.
function localSkipReason(
  front: Record<string, unknown>,
  now: Date,
): 'future-dated' | 'unpublished' | null {
  if (front.published === false) return 'unpublished';
  const date = front.date;
  if (date != null) {
    const d = date instanceof Date ? date : new Date(String(date));
    if (!Number.isNaN(d.getTime()) && d.getTime() > now.getTime()) return 'future-dated';
  }
  return null;
}

export async function* trackPublish(
  deps: TrackDeps,
  target: TrackTarget,
  opts: TrackOptions = {},
): AsyncGenerator<FinishLineEvent> {
  const { gh, fetchSite, sleep, now = () => new Date() } = deps;
  const {
    pollMs = 3000,
    maxDeploymentPolls = 20,
    maxStatusPolls = 100,
    sitemapRetries = 3,
  } = opts;

  // One call answers "is Pages even configured?" before any polling — but a 404
  // has two causes GitHub refuses to distinguish: Pages is off, or the repo is
  // private and this token lacks Pages:read (measured: a Contents-only token
  // reads /pages fine on a public repo, never on a private one). `private`
  // separates them, and it is already on a response we fetch. Told a private
  // repo's owner "Pages is not turned on", we would be flatly lying about a
  // site that is live.
  if ((await gh.getPages()) === null) {
    yield { kind: (await gh.getRepo()).private ? 'pages-unreadable' : 'no-pages' };
    return;
  }

  yield { kind: 'publishing' };

  // Build phase (#9). The `build` check-run is the only signal that reports a
  // red build: a failed build never deploys, so the Deployments API has nothing
  // to fail and `pages/builds/latest` sticks at "building" forever (both
  // measured). Poll the check-run to a terminal outcome.
  let built = false;
  let lastState = '';
  for (let i = 0; i < maxStatusPolls; i++) {
    const build = await gh.getBuildState(target.sha);
    if (build.conclusion === 'failure') {
      // Translate only from the raw log, and only blame the user when it names
      // the file they just published — a wrong file is worse than none (#9).
      const cause = parseBuildFailure((await gh.getBuildLog(target.sha)) ?? '');
      if (cause) {
        yield { kind: 'build-failed', cause: { ...cause, mine: cause.file === target.path } };
      } else {
        yield { kind: 'build-failed' };
      }
      return;
    }
    if (build.status === 'completed') {
      built = true; // success or neutral — either way, look for the live URL
      break;
    }
    // Dedup on the DISPLAYED state, not the raw status: `none` (no run yet) and
    // `queued` both read as "waiting to start", and emitting that line twice
    // looks like a stutter.
    const shown = build.status === 'in_progress' ? 'in_progress' : 'queued';
    if (shown !== lastState) {
      lastState = shown;
      yield { kind: 'building', state: shown };
    }
    await sleep(pollMs);
  }
  if (!built) {
    yield { kind: 'timeout' };
    return;
  }

  // URL phase: a successful build deployed, so the deployment now carries the
  // site root. It is only needed for that root — the build's outcome is already
  // known from the check-run above.
  let siteRoot: string | null = null;
  for (let i = 0; i < maxDeploymentPolls && !siteRoot; i++) {
    const deployment = await gh.getDeployment(target.sha);
    const url = deployment ? (await gh.getDeploymentStatuses(deployment.id))[0]?.environment_url : undefined;
    if (url) siteRoot = url.endsWith('/') ? url : `${url}/`;
    else await sleep(pollMs);
  }
  if (!siteRoot) {
    yield { kind: 'timeout' };
    return;
  }

  // URL discovery: Jekyll computed the URL itself, so the sitemap is the
  // source — cross-checked, because it reproduces the user's misconfiguration.
  for (let attempt = 0; ; attempt++) {
    const res = await fetchSite(`${siteRoot}sitemap.xml`);
    if (res.status === 404) {
      yield { kind: 'built-no-sitemap', siteRoot };
      return;
    }
    const locs = extractLocs(await res.text());
    const mine = locs.find((l) => matchesSlug(l, target.slug));
    if (mine) {
      if (!mine.startsWith(siteRoot)) {
        yield { kind: 'baseurl-misconfigured', sitemapUrl: mine, siteRoot };
        return;
      }
      const live = await fetchSite(mine);
      yield live.ok ? { kind: 'live', url: mine } : { kind: 'live-unverified', url: mine };
      return;
    }
    // Absent from the sitemap on a green build: Jekyll deliberately skipped
    // it — if the front matter explains why, that is the answer.
    const reason = localSkipReason(target.front, now());
    if (reason) {
      yield { kind: 'skipped', reason };
      return;
    }
    if (attempt >= sitemapRetries - 1) {
      yield { kind: 'not-in-sitemap', siteRoot };
      return;
    }
    await sleep(pollMs);
  }
}
