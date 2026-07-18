import { describe, expect, it } from 'vitest';
import { watchInstall, type FinishClient } from '../../src/installer/finish.js';

// A fake client: nothing has happened yet (build in progress, no deployment),
// overridable per test.
function fake(over: Partial<FinishClient> = {}): FinishClient {
  return {
    getBuildState: async () => ({ status: 'in_progress', conclusion: null }),
    getDeployment: async () => null,
    getDeploymentStatuses: async () => [],
    ...over,
  };
}

// Never touch a real timer.
const nap = async () => {};

describe('watchInstall (#30 follow-up: honest completion)', () => {
  it('reports live when the github-pages deployment reaches success', async () => {
    const outcome = await watchInstall(
      fake({
        getDeployment: async () => ({ id: 7 }),
        getDeploymentStatuses: async () => [{ state: 'success' }],
      }),
      'sha',
      { sleep: nap, maxTicks: 3 },
    );
    expect(outcome).toBe('live');
  });

  it('reports failed on a completed-failure build check-run — never a false live', async () => {
    const outcome = await watchInstall(
      fake({ getBuildState: async () => ({ status: 'completed', conclusion: 'failure' }) }),
      'sha',
      { sleep: nap, maxTicks: 3 },
    );
    expect(outcome).toBe('failed');
  });

  it('reports failed when a deployment status is error', async () => {
    const outcome = await watchInstall(
      fake({
        getDeployment: async () => ({ id: 7 }),
        getDeploymentStatuses: async () => [{ state: 'error' }],
      }),
      'sha',
      { sleep: nap, maxTicks: 3 },
    );
    expect(outcome).toBe('failed');
  });

  it('reports building on timeout when something was underway (a build check-run exists)', async () => {
    let sleeps = 0;
    // default fake: build is in_progress = activity seen, but never completes.
    const outcome = await watchInstall(fake(), 'sha', {
      sleep: async () => {
        sleeps++;
      },
      maxTicks: 4,
    });
    expect(outcome).toBe('building');
    expect(sleeps).toBe(4);
  });

  it('reports not-building when nothing ever started (no check-run, no deployment)', async () => {
    // The welcome-to-the-internet case: the push triggered no Pages build at all.
    const outcome = await watchInstall(
      fake({ getBuildState: async () => ({ status: 'none', conclusion: null }) }),
      'sha',
      { sleep: nap, maxTicks: 3 },
    );
    expect(outcome).toBe('not-building');
  });

  it('calls onProgress once per tick with elapsed time', async () => {
    const seen: number[] = [];
    let t = 1000;
    await watchInstall(fake(), 'sha', {
      sleep: nap,
      maxTicks: 3,
      now: () => (t += 5000), // start, then +5s per read
      onProgress: (ms) => seen.push(ms),
    });
    expect(seen).toHaveLength(3);
    expect(seen.every((ms) => ms >= 0)).toBe(true);
  });

  it('tolerates transient API errors mid-poll without throwing', async () => {
    let n = 0;
    const outcome = await watchInstall(
      fake({
        getDeployment: async () => {
          n++;
          if (n === 1) throw new Error('flaky');
          return { id: 7 };
        },
        getDeploymentStatuses: async () => [{ state: 'success' }],
      }),
      'sha',
      { sleep: nap, maxTicks: 3 },
    );
    expect(outcome).toBe('live');
  });
});
