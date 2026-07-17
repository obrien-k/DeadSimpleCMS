import { useEffect, useState } from 'preact/hooks';
import { GhError, type GhClient } from '../../gh/index.js';
import { trackPublish, trackRevert, type FinishLineEvent } from '../../finishline/index.js';
import { describeEvent, MSG } from '../messages.js';
import { editRoute } from '../router.js';

export interface PublishTarget {
  sha: string;
  slug: string;
  /** The published file's path — attributes a build failure to this post (#9). */
  path: string;
  /** The draft this post was published from — where Undo restores it (#9). */
  from: string;
  front: Record<string, unknown>;
}

export interface PublishProps {
  gh: GhClient;
  target: PublishTarget;
  onDone(): void;
}

// The reverse of the publish move (#9): restore the draft with the post's exact
// content and delete the post. Pure so the commit shape is a test, not a thing
// found by hand. Images that rode the publish commit are deliberately NOT
// touched — the restored draft still references them, so removing them would
// break it. This is unpublish, not a git-commit revert.
export function buildUnpublish(
  target: Pick<PublishTarget, 'path' | 'from' | 'slug' | 'front'>,
  content: string,
): { message: string; changes: { path: string; content: string }[]; deletions: string[] } {
  const label = (typeof target.front.title === 'string' && target.front.title) || target.slug;
  return {
    message: `Unpublish: ${label}`,
    changes: [{ path: target.from, content }],
    deletions: [target.path],
  };
}

const TERMINAL = new Set([
  'no-pages', 'pages-unreadable', 'build-failed', 'live', 'live-unverified', 'skipped',
  'baseurl-misconfigured', 'not-in-sitemap', 'built-no-sitemap', 'timeout',
  'reverted', 'revert-failed',
]);

// The undo's own terminal states — once the site has rebuilt (either way), the
// only thing left is to send the writer to their restored draft.
const REVERT_DONE = new Set(['reverted', 'revert-failed', 'timeout']);

export function PublishView({ gh, target, onDone }: PublishProps) {
  const [events, setEvents] = useState<FinishLineEvent[]>([]);
  const [revertSha, setRevertSha] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoErr, setUndoErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gen = trackPublish(
        {
          gh,
          fetchSite: fetch.bind(globalThis),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        },
        target,
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

  // Once the undo commit lands, its sha drives a second finish line — the site
  // rebuilding without the post. Its events append to the same list so the
  // writer sees one continuous story: failed → undoing → building → done.
  useEffect(() => {
    if (!revertSha) return;
    let cancelled = false;
    (async () => {
      const gen = trackRevert(
        { gh, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
        { sha: revertSha },
      );
      for await (const e of gen) {
        if (cancelled) return;
        setEvents((prev) => [...prev, e]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [revertSha]);

  async function undo() {
    setUndoing(true);
    setUndoErr(null);
    try {
      const file = await gh.readFile(target.path);
      const head = await gh.getHeadSha();
      const { message, changes, deletions } = buildUnpublish(target, file.text);
      const { sha } = await gh.commit({ message, changes, deletions, expectedHeadSha: head });
      setRevertSha(sha);
    } catch (e) {
      setUndoErr(
        e instanceof GhError && e.conflict ? MSG.conflict : String(e instanceof Error ? e.message : e),
      );
    } finally {
      setUndoing(false);
    }
  }

  const last = events.at(-1);
  const done = last != null && TERMINAL.has(last.kind);
  // Undo is offered only when the log named THIS post — the case where removing
  // it can actually turn the site green (#9). Hidden once the undo is under way.
  const showUndo =
    last?.kind === 'build-failed' && last.cause?.mine === true && revertSha === null && !undoing;
  const revertDone = last != null && REVERT_DONE.has(last.kind);

  return (
    <div class="publish">
      <h1>Publishing</h1>
      <ol>
        {events.map((e, i) => (
          <li key={i} class={i === events.length - 1 ? 'current' : 'past'}>
            {describeEvent(e)}
            {e.kind === 'live' && (
              <>
                {' '}
                <a href={e.url} target="_blank" rel="noopener noreferrer">
                  {e.url}
                </a>
              </>
            )}
          </li>
        ))}
        {undoing && <li class="current">Undoing…</li>}
      </ol>
      {undoErr && <p class="banner">{undoErr}</p>}
      {showUndo && (
        <button type="button" class="primary" onClick={undo}>
          Undo this publish
        </button>
      )}
      {revertDone && (
        <button type="button" class="primary" onClick={() => (location.hash = editRoute(target.from))}>
          Edit the draft
        </button>
      )}
      {done && (
        <button type="button" onClick={onDone}>
          Back to posts
        </button>
      )}
    </div>
  );
}
