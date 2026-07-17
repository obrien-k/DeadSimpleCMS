import { useEffect, useState } from 'preact/hooks';
import type { GhClient } from '../../gh/index.js';
import { loadListing, type ListingResult } from '../../listing/index.js';
import type { Resolved } from '../../layout/index.js';
import { editRoute } from '../router.js';
import { MSG } from '../messages.js';

export interface ListProps {
  gh: GhClient;
  storage: Storage;
  /** Entries arrive resolved: where Jekyll reads from is settled before this view runs (#17). */
  resolved: Resolved;
}

export function ListView({ gh, storage, resolved }: ListProps) {
  const [listing, setListing] = useState<ListingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadListing(gh, storage, resolved)
      .then(setListing)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [gh, resolved]);

  if (error) return <p class="banner error">Could not load your posts: {error}</p>;
  if (!listing) return <p>Loading your posts…</p>;

  return (
    <div class="list">
      <header>
        <h1>Posts</h1>
        <a class="button" href="#/new">
          New post
        </a>
      </header>
      {listing.drafts.length > 0 && (
        <section>
          <h2>Drafts</h2>
          <ul>
            {listing.drafts.map((d) => (
              <li key={d.oid}>
                <a href={editRoute(d.path)}>{d.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2>Published</h2>
        {listing.posts.length === 0 && <p>No posts yet — write the first one!</p>}
        <ul>
          {listing.posts.map((p) => (
            <li key={p.oid}>
              <a href={editRoute(p.path)}>{p.title}</a> <time>{p.date}</time>
            </li>
          ))}
        </ul>
      </section>
      {/* Pages (#12). No "New page" button: a page's location is a convention
          only the site knows — `_pages/` on minimal-mistakes, the root
          elsewhere — and nothing in _config.yml declares it, so any target
          would be a guess. Absent when the site has none, exactly like Drafts;
          absent when the tree was truncated, because the walk never ran. */}
      {listing.pages.length > 0 && (
        <section>
          <h2>Pages</h2>
          <ul>
            {listing.pages.map((p) => (
              <li key={p.oid}>
                <a href={editRoute(p.path)}>{p.title}</a> <small>{p.path}</small>
              </li>
            ))}
          </ul>
          <p class="note">{MSG.pagesBlindSpot}</p>
        </section>
      )}
    </div>
  );
}
