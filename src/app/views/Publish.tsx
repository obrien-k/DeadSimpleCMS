import { useEffect, useState } from 'preact/hooks';
import type { GhClient } from '../../gh/index.js';
import { trackPublish, type FinishLineEvent } from '../../finishline/index.js';
import { describeEvent } from '../messages.js';

export interface PublishTarget {
  sha: string;
  slug: string;
  front: Record<string, unknown>;
}

export interface PublishProps {
  gh: GhClient;
  target: PublishTarget;
  onDone(): void;
}

const TERMINAL = new Set([
  'no-pages', 'pages-unreadable', 'build-failed', 'live', 'live-unverified', 'skipped',
  'baseurl-misconfigured', 'not-in-sitemap', 'built-no-sitemap', 'timeout',
]);

export function PublishView({ gh, target, onDone }: PublishProps) {
  const [events, setEvents] = useState<FinishLineEvent[]>([]);

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

  const last = events.at(-1);
  const done = last && TERMINAL.has(last.kind);

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
      </ol>
      {done && (
        <button type="button" onClick={onDone}>
          Back to posts
        </button>
      )}
    </div>
  );
}
