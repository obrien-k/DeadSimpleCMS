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
import type { Deployment, DeploymentStatus, PagesInfo } from '../gh/index.js';

export type FinishLineEvent =
  | { kind: 'no-pages' }
  | { kind: 'publishing' }
  | { kind: 'building'; state: string }
  | { kind: 'build-failed' }
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
  /** The front matter the app just wrote — the local answer to "why skipped?". */
  front: Record<string, unknown>;
}

export interface TrackOptions {
  pollMs?: number;
  maxDeploymentPolls?: number;
  maxStatusPolls?: number;
  sitemapRetries?: number;
}

const TERMINAL_FAILURE = new Set(['error', 'failure', 'inactive']);

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

  // One call answers "is Pages even configured?" before any polling.
  if ((await gh.getPages()) === null) {
    yield { kind: 'no-pages' };
    return;
  }

  yield { kind: 'publishing' };
  let deployment: Deployment | null = null;
  for (let i = 0; i < maxDeploymentPolls && !deployment; i++) {
    deployment = await gh.getDeployment(target.sha);
    if (!deployment) await sleep(pollMs);
  }
  if (!deployment) {
    yield { kind: 'timeout' };
    return;
  }

  let siteRoot: string | null = null;
  let lastState = '';
  let success = false;
  for (let i = 0; i < maxStatusPolls; i++) {
    const statuses = await gh.getDeploymentStatuses(deployment.id);
    const latest = statuses[0];
    if (latest) {
      if (latest.environment_url) {
        siteRoot = latest.environment_url.endsWith('/')
          ? latest.environment_url
          : `${latest.environment_url}/`;
      }
      if (latest.state === 'success') {
        success = true;
        break;
      }
      if (TERMINAL_FAILURE.has(latest.state)) {
        // The honest fallback (#9): say it failed; never guess attribution.
        yield { kind: 'build-failed' };
        return;
      }
      if (latest.state !== lastState) {
        lastState = latest.state;
        yield { kind: 'building', state: latest.state };
      }
    }
    await sleep(pollMs);
  }
  if (!success || !siteRoot) {
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
