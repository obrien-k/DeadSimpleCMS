import { useEffect, useState } from 'preact/hooks';
import type { GhClient } from '../../gh/index.js';
import { loadListing, type ListingResult } from '../../listing/index.js';
import type { Resolved } from '../../layout/index.js';
import { editRoute } from '../router.js';

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
    </div>
  );
}
