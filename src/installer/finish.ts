// Watching an install to a real end state (#29 follow-up). The old inline poll
// watched only the `build` check-run and then declared "live" whether or not
// anything had finished — the 404-on-success dogfooding bug. This watches the
// Pages *deployment* (the real "published to the CDN" signal, and the one that
// works for both legacy and workflow builds, where the check-run isn't named
// "build"), keeps the check-run only to catch a *failed* build fast, and never
// claims success it hasn't seen: a timeout resolves as 'building', honestly.

export type InstallOutcome = 'live' | 'building' | 'failed';

// The slice of the gh client this needs — structural, so tests pass a fake and
// the real GhClient satisfies it without importing it here.
export interface FinishClient {
  getDeployment(sha: string): Promise<{ id: number } | null>;
  getDeploymentStatuses(id: number): Promise<{ state: string }[]>;
  getBuildState(sha: string): Promise<{ status: string; conclusion: string | null }>;
}

export interface WatchInstallOptions {
  /** Called once per poll with elapsed ms, so a UI can show motion. */
  onProgress?: (elapsedMs: number) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Poll cap. Default 30 × 5s ≈ 150s, then an honest 'building'. */
  maxTicks?: number;
  intervalMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function watchInstall(
  gh: FinishClient,
  sha: string,
  opts: WatchInstallOptions = {},
): Promise<InstallOutcome> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? defaultSleep;
  const maxTicks = opts.maxTicks ?? 30;
  const intervalMs = opts.intervalMs ?? 5000;
  const start = now();

  for (let i = 0; i < maxTicks; i++) {
    opts.onProgress?.(now() - start);

    // A failed build never deploys — the Deployments API would then show nothing
    // to succeed *or* fail, so the poll would hang to the timeout. Check the
    // check-run for red first and bail fast.
    const build = await gh.getBuildState(sha).catch(() => null);
    if (build?.status === 'completed' && build.conclusion === 'failure') return 'failed';

    // The deployment reaching `success` is the real "it's live" signal.
    const dep = await gh.getDeployment(sha).catch(() => null);
    if (dep) {
      const statuses = await gh.getDeploymentStatuses(dep.id).catch(() => []);
      if (statuses.some((s) => s.state === 'success')) return 'live';
      if (statuses.some((s) => s.state === 'error' || s.state === 'failure')) return 'failed';
    }

    await sleep(intervalMs);
  }
  // Bounded, not infinite: we've waited long enough that "still building, here's
  // your link" is more use than spinning. Never a false "live".
  return 'building';
}
