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

/** A page (#12): no date, no draft state, no publish move — its path is its identity. */
export interface PageMeta {
  path: string;
  title: string;
  oid: string;
}

export interface ListingResult {
  posts: PostMeta[];
  drafts: PostMeta[];
  pages: PageMeta[];
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
  // Does the blob have front matter? This is what makes a file a page (#12) —
  // `README.md` has none and is a static file to Jekyll, while a front-matter'd
  // file with no `title:` IS a page that falls back to a humanized filename.
  // `title: ''` cannot tell those apart, which is why the flag exists.
  //
  // Optional because entries written before #12 lack it: a missing flag means
  // "never asked", so the first page candidate that meets one re-reads and
  // self-heals. Nothing to migrate and no key to bump — the entry is a pure
  // function of blob content, so an incomplete one costs exactly one read.
  fm?: boolean;
}

const POST_NAME = /^(\d{4}-\d{2}-\d{2})-(.+)\.(md|markdown)$/;

/** Lower-cased, no dot; '' when the name has none (`LICENSE`) — which is the blind spot, stated. */
const ext = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
};

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
  { entries, layout, sourceFiles }: Resolved,
): Promise<ListingResult> {
  const cache = readCache(storage);

  const all = [
    ...entries.posts.map((e) => ({ e, draft: false })),
    ...entries.drafts.map((e) => ({ e, draft: true })),
  ];

  // Page candidates (#12). `sourceFiles` is everything Jekyll walks that is not
  // a post or draft, already fenced by src/layout/, so this filter is the whole
  // of the extra work — the walk itself cost nothing extra.
  const candidates = sourceFiles.filter((f) => layout.pageExts.includes(ext(f.name)));

  // Posts are identified by path shape, so a cached title is the whole answer.
  // A candidate needs `fm` too, and a pre-#12 entry does not have it.
  const misses = [
    ...all.filter(({ e }) => !cache[e.oid]).map(({ e }) => e.oid),
    ...candidates.filter((f) => cache[f.oid]?.fm === undefined).map((f) => f.oid),
  ];
  if (misses.length > 0) {
    const blobs = await gh.fetchBlobs([...new Set(misses)]);
    for (const oid of misses) {
      const blob = blobs.get(oid);
      // Binary / truncated blobs degrade to a filename-derived title below, and
      // cannot be shown to have front matter — so they are not pages either.
      const parsed = blob && !blob.isBinary && blob.text ? read(blob.text) : null;
      cache[oid] = { title: (parsed?.data.title as string | undefined) ?? '', fm: parsed !== null };
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
    // Front matter is what makes a page, so a candidate the cache says has none
    // (README.md) is a static file and drops out here. Alphabetical by path:
    // there is no date to sort on, and path is what identifies a page.
    pages: candidates
      .filter((f) => cache[f.oid]?.fm)
      .map((f) => ({
        path: f.path,
        title: cache[f.oid]?.title || humanize(f.name.replace(/\.[^.]+$/, '')),
        oid: f.oid,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}
