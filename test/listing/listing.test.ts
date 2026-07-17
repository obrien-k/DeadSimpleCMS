import { describe, expect, it } from 'vitest';
import { loadListing } from '../../src/listing/index.js';
import type { BlobResult, Entry } from '../../src/gh/index.js';

// The listing module needs only these two operations — not the whole client.
function fakeGh(listing: { posts: Entry[]; drafts: Entry[] }, blobs: Record<string, BlobResult>) {
  const calls: string[] = [];
  return {
    calls,
    listEntries: async () => {
      calls.push('listEntries');
      return listing;
    },
    fetchBlobs: async (oids: string[]) => {
      calls.push(`fetchBlobs:${oids.join(',')}`);
      return new Map(oids.filter((o) => blobs[o]).map((o) => [o, blobs[o]!]));
    },
  };
}

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

const post = (name: string, oid: string) => ({ name, oid });
const md = (title: string) => ({
  text: `---\ntitle: ${title}\n---\n\nBody.\n`,
  isBinary: false,
  isTruncated: false,
});

describe('loadListing', () => {
  it('cold start: fetches missing blobs, resolves titles, fills the cache', async () => {
    const gh = fakeGh(
      { posts: [post('2026-07-01-first-post.md', 'oid-1')], drafts: [post('wip.md', 'oid-2')] },
      { 'oid-1': md('The First Post'), 'oid-2': md('Work In Progress') },
    );
    const storage = memStorage();
    const { posts, drafts } = await loadListing(gh, storage);

    expect(posts).toEqual([
      {
        path: '_posts/2026-07-01-first-post.md',
        slug: 'first-post',
        date: '2026-07-01',
        title: 'The First Post',
        draft: false,
        oid: 'oid-1',
      },
    ]);
    expect(drafts[0]).toMatchObject({
      path: '_drafts/wip.md',
      slug: 'wip',
      date: null,
      title: 'Work In Progress',
      draft: true,
    });
    expect(gh.calls).toEqual(['listEntries', 'fetchBlobs:oid-1,oid-2']);
    expect(storage.dump()['dscms:titles']).toContain('The First Post');
  });

  it('steady state: one call, zero blob fetches', async () => {
    const gh = fakeGh({ posts: [post('2026-07-01-first-post.md', 'oid-1')], drafts: [] }, {});
    const storage = memStorage({
      'dscms:titles': JSON.stringify({ 'oid-1': { title: 'Cached Title' } }),
    });
    const { posts } = await loadListing(gh, storage);
    expect(posts[0]!.title).toBe('Cached Title');
    expect(gh.calls).toEqual(['listEntries']);
  });

  it('an edited post is a new oid, i.e. a cache miss', async () => {
    const gh = fakeGh(
      { posts: [post('2026-07-01-first-post.md', 'oid-NEW')], drafts: [] },
      { 'oid-NEW': md('Retitled') },
    );
    const storage = memStorage({
      'dscms:titles': JSON.stringify({ 'oid-OLD': { title: 'Stale' } }),
    });
    const { posts } = await loadListing(gh, storage);
    expect(posts[0]!.title).toBe('Retitled');
    expect(gh.calls).toContain('fetchBlobs:oid-NEW');
  });

  it('degrades to a filename-derived title for binary or title-less blobs', async () => {
    const gh = fakeGh(
      {
        posts: [
          post('2026-07-01-binary-thing.md', 'oid-b'),
          post('2026-07-02-no-title.md', 'oid-n'),
        ],
        drafts: [],
      },
      {
        'oid-b': { text: null, isBinary: true, isTruncated: false },
        'oid-n': { text: '---\nlayout: post\n---\n\nB.\n', isBinary: false, isTruncated: false },
      },
    );
    const { posts } = await loadListing(gh, memStorage());
    expect(posts.map((p) => p.title)).toEqual(['No Title', 'Binary Thing']);
  });

  it('sorts posts by date descending; drafts keep name order', async () => {
    const gh = fakeGh(
      {
        posts: [
          post('2026-01-05-older.md', 'a'),
          post('2026-07-01-newer.md', 'b'),
        ],
        drafts: [post('b-draft.md', 'c'), post('a-draft.md', 'd')],
      },
      {},
    );
    const storage = memStorage({
      'dscms:titles': JSON.stringify({
        a: { title: 'Older' }, b: { title: 'Newer' }, c: { title: 'B' }, d: { title: 'A' },
      }),
    });
    const { posts, drafts } = await loadListing(gh, storage);
    expect(posts.map((p) => p.slug)).toEqual(['newer', 'older']);
    expect(drafts.map((d) => d.slug)).toEqual(['a-draft', 'b-draft']);
  });

  it('survives a corrupt cache', async () => {
    const gh = fakeGh(
      { posts: [post('2026-07-01-a.md', 'oid-1')], drafts: [] },
      { 'oid-1': md('A') },
    );
    const { posts } = await loadListing(gh, memStorage({ 'dscms:titles': 'not json{' }));
    expect(posts[0]!.title).toBe('A');
  });
});
