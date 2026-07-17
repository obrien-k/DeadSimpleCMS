import { useEffect, useState } from 'preact/hooks';
import type { GhClient } from '../../gh/index.js';
import { trackRevert, type FinishLineEvent } from '../../finishline/index.js';
import { describeEvent, MSG } from '../messages.js';
import { editRoute } from '../router.js';

export interface UnpublishTarget {
  /** The unpublish commit's sha — the build to watch back to green (#16). */
  sha: string;
  /** The draft the post was moved to — where "Edit the draft" lands. */
  from: string;
}

export interface UnpublishProps {
  gh: GhClient;
  target: UnpublishTarget;
  onDone(): void;
}

// Taking a post down gets the same honest finish line as putting one up (#16):
// the commit already landed in the Editor, so this only watches the rebuild.
// It reuses trackRevert — the "watch a post-removal build" generator from #9 —
// and shares its copy for every state but the green one, which here means
// "unpublished", not "undone".
const DONE = new Set(['reverted', 'revert-failed', 'timeout']);

export function UnpublishView({ gh, target, onDone }: UnpublishProps) {
  const [events, setEvents] = useState<FinishLineEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gen = trackRevert(
        { gh, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
        { sha: target.sha },
      );
      for await (const e of gen) {
        if (cancelled) return;
        setEvents((prev) => [...prev, e]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.sha]);

  const last = events.at(-1);
  const done = last != null && DONE.has(last.kind);

  return (
    <div class="publish">
      <h1>Unpublishing</h1>
      <ol>
        {events.map((e, i) => (
          <li key={i} class={i === events.length - 1 ? 'current' : 'past'}>
            {e.kind === 'reverted' ? MSG.unpublished : describeEvent(e)}
          </li>
        ))}
      </ol>
      {done && (
        <>
          <button
            type="button"
            class="primary"
            onClick={() => (location.hash = editRoute(target.from))}
          >
            Edit the draft
          </button>
          <button type="button" onClick={onDone}>
            Back to posts
          </button>
        </>
      )}
    </div>
  );
}
