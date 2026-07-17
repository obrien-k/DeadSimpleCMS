import { describe, expect, it } from 'vitest';
import { trackRevert, type FinishLineEvent } from '../../src/finishline/index.js';
import type { BuildState } from '../../src/gh/index.js';

// trackRevert watches only the `build` check-run, so the fake is just a script
// of per-poll states — no deployment, sitemap, or log surface (a removed post
// is never attributed, so no log is ever fetched).
function fakes(build: BuildState[]) {
  let polls = 0;
  const gh = {
    getBuildState: async (): Promise<BuildState> => build[Math.min(polls++, build.length - 1)]!,
  };
  return { gh, sleep: async () => {} };
}

async function drain(gen: AsyncGenerator<FinishLineEvent>): Promise<FinishLineEvent[]> {
  const out: FinishLineEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const TARGET = { sha: 'r' };

describe('trackRevert', () => {
  // The break was this post's: removing it turns the site green again.
  it('a green rebuild after the undo reports reverted', async () => {
    const f = fakes([
      { status: 'queued', conclusion: null },
      { status: 'in_progress', conclusion: null },
      { status: 'completed', conclusion: 'success' },
    ]);
    const events = await drain(trackRevert(f, TARGET));
    expect(events).toEqual([
      { kind: 'building', state: 'queued' },
      { kind: 'building', state: 'in_progress' },
      { kind: 'reverted' },
    ]);
  });

  // The site was already red before this post: the undo lands but cannot fix a
  // break it never caused, so revert-failed — never blamed on the gone post.
  it('a still-red rebuild reports revert-failed, not the post', async () => {
    const f = fakes([{ status: 'completed', conclusion: 'failure' }]);
    const events = await drain(trackRevert(f, TARGET));
    expect(events).toEqual([{ kind: 'revert-failed' }]);
  });

  // Same displayed-state dedup as trackPublish — proves the shared watchBuild:
  // `none` then `queued` are one line, not two.
  it('collapses none→queued into a single waiting line', async () => {
    const f = fakes([
      { status: 'none', conclusion: null },
      { status: 'queued', conclusion: null },
      { status: 'completed', conclusion: 'success' },
    ]);
    const events = await drain(trackRevert(f, TARGET));
    expect(events).toEqual([{ kind: 'building', state: 'queued' }, { kind: 'reverted' }]);
  });

  it('times out if the build never reaches a terminal state', async () => {
    const f = fakes([{ status: 'in_progress', conclusion: null }]);
    const events = await drain(trackRevert(f, TARGET, { maxStatusPolls: 3 }));
    expect(events.at(-1)).toEqual({ kind: 'timeout' });
  });
});
