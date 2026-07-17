// Two-phase post listing (DESIGN.md "Content operations"). Phase 1 is the lean
// GraphQL listing — the only call in steady state. Phase 2 fetches only cache
// misses. Blob oids are content hashes, so the oid-keyed cache never goes
// stale: an edited post is a new oid, i.e. a miss. Invalidation is deleted,
// not managed.
import type { BlobResult } from '../gh/index.js';
import type { FoundFile, Resolved } from '../layout/index.js';
import { read } from '../frontmatter/index.js';

export interface PostMeta {
  path: string;
  slug: string;
  /** YYYY-MM-DD from the filename; null for drafts (their date lives in front matter). */
  date: string | null;
  title: string;
  draft: boolean;
  oid: string;
}

export interface ListingResult {
  posts: PostMeta[];
  drafts: PostMeta[];
}

interface ListingSource {
  fetchBlobs(oids: string[]): Promise<Map<string, BlobResult>>;
}

// localStorage-shaped; injected so tests never touch a real origin. The cache
// holds ONLY listing metadata — already-public content. Never the token,
// never draft bodies (localStorage is shared origin-wide on github.io).
type KVStorage = Pick<Storage, 'getItem' | 'setItem'>;

const CACHE_KEY = 'dscms:titles';

interface CacheEntry {
  title: string;
}

const POST_NAME = /^(\d{4}-\d{2}-\d{2})-(.+)\.(md|markdown)$/;

const humanize = (slug: string) =>
  slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

function parseName(name: string, draft: boolean): { slug: string; date: string | null } {
  if (!draft) {
    const m = name.match(POST_NAME);
    if (m) return { date: m[1]!, slug: m[2]! };
  }
  return { date: null, slug: name.replace(/\.(md|markdown)$/, '') };
}

function readCache(storage: KVStorage): Record<string, CacheEntry> {
  try {
    const parsed = JSON.parse(storage.getItem(CACHE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // corrupt cache = cold start, never a failure
  }
}

// Entries arrive already resolved and already fetched (#17): where Jekyll reads
// from is `src/layout/`'s question, and answering it costs the same query that
// would fetch them. This module never names `_posts` — that hardcode is what
// hid #17 for a phase.
export async function loadListing(
  gh: ListingSource,
  storage: KVStorage,
  { entries }: Resolved,
): Promise<ListingResult> {
  const cache = readCache(storage);

  const all = [
    ...entries.posts.map((e) => ({ e, draft: false })),
    ...entries.drafts.map((e) => ({ e, draft: true })),
  ];

  const misses = all.filter(({ e }) => !cache[e.oid]).map(({ e }) => e.oid);
  if (misses.length > 0) {
    const blobs = await gh.fetchBlobs(misses);
    for (const oid of misses) {
      const blob = blobs.get(oid);
      // Binary / truncated / title-less blobs degrade to a filename-derived
      // title below (cache stores nothing, so `title` stays undefined-safe).
      const title =
        blob && !blob.isBinary && blob.text ? (read(blob.text)?.data.title as string | undefined) : undefined;
      cache[oid] = { title: title ?? '' };
    }
    storage.setItem(CACHE_KEY, JSON.stringify(cache));
  }

  const toMeta = ({ e, draft }: { e: FoundFile; draft: boolean }): PostMeta => {
    const { slug, date } = parseName(e.name, draft);
    return {
      path: e.path,
      slug,
      date,
      title: cache[e.oid]?.title || humanize(slug),
      draft,
      oid: e.oid,
    };
  };

  return {
    posts: all
      .filter((x) => !x.draft)
      .map(toMeta)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    drafts: all
      .filter((x) => x.draft)
      .map(toMeta)
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}
