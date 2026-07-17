import { describe, expect, it } from 'vitest';
import { loadListing } from '../../src/listing/index.js';
import type { BlobResult } from '../../src/gh/index.js';
import type { FoundFile, Resolved } from '../../src/layout/index.js';

// The listing module needs only one operation now — not the whole client, and
// no listing call at all: entries arrive already resolved (#17).
function fakeGh(blobs: Record<string, BlobResult>) {
  const calls: string[] = [];
  return {
    calls,
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

const at = (dir: string, name: string, oid: string): FoundFile => ({
  path: `${dir}/${name}`,
  name,
  oid,
});
const post = (name: string, oid: string, root = '') => at(root ? `${root}/_posts` : '_posts', name, oid);
const draft = (name: string, oid: string, root = '') =>
  at(root ? `${root}/_drafts` : '_drafts', name, oid);

const resolvedOf = (
  posts: FoundFile[],
  drafts: FoundFile[],
  root = '',
  sourceFiles: FoundFile[] = [],
): Resolved => ({
  layout: {
    branch: 'main',
    sourceRoot: root,
    postsDirs: [root ? `${root}/_posts` : '_posts'],
    draftsDirs: [root ? `${root}/_drafts` : '_drafts'],
    writeBase: root,
    basis: 'pages',
    postsScan: 'recursive',
    pageExts: ['markdown', 'mkdown', 'mkdn', 'mkd', 'md', 'html', 'htm'],
  },
  entries: { posts, drafts },
  sourceFiles,
});

const file = (path: string, oid: string): FoundFile => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  oid,
});

const md = (title: string) => ({
  text: `---\ntitle: ${title}\n---\n\nBody.\n`,
  isBinary: false,
  isTruncated: false,
});

describe('loadListing', () => {
  it('cold start: fetches missing blobs, resolves titles, fills the cache', async () => {
    const gh = fakeGh({ 'oid-1': md('The First Post'), 'oid-2': md('Work In Progress') });
    const storage = memStorage();
    const { posts, drafts } = await loadListing(
      gh,
      storage,
      resolvedOf([post('2026-07-01-first-post.md', 'oid-1')], [draft('wip.md', 'oid-2')]),
    );

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
    expect(gh.calls).toEqual(['fetchBlobs:oid-1,oid-2']);
    expect(storage.dump()['dscms:titles']).toContain('The First Post');
  });

  // The #17 regression: on a /docs-served site every path must carry the root.
  // The old code rebuilt `_posts/<name>` from a hardcoded literal, so it linked
  // to files that do not exist and published where Jekyll never reads.
  it('takes paths from the resolved root, never from a hardcoded _posts', async () => {
    const gh = fakeGh({});
    const storage = memStorage({
      'dscms:titles': JSON.stringify({ 'oid-1': { title: 'A' }, 'oid-2': { title: 'B' } }),
    });
    const { posts, drafts } = await loadListing(
      gh,
      storage,
      resolvedOf([post('2026-07-01-a.md', 'oid-1', 'docs')], [draft('b.md', 'oid-2', 'docs')], 'docs'),
    );
    expect(posts[0]!.path).toBe('docs/_posts/2026-07-01-a.md');
    expect(drafts[0]!.path).toBe('docs/_drafts/b.md');
  });

  it('steady state: zero blob fetches', async () => {
    const gh = fakeGh({});
    const storage = memStorage({
      'dscms:titles': JSON.stringify({ 'oid-1': { title: 'Cached Title' } }),
    });
    const { posts } = await loadListing(
      gh,
      storage,
      resolvedOf([post('2026-07-01-first-post.md', 'oid-1')], []),
    );
    expect(posts[0]!.title).toBe('Cached Title');
    expect(gh.calls).toEqual([]);
  });

  it('an edited post is a new oid, i.e. a cache miss', async () => {
    const gh = fakeGh({ 'oid-NEW': md('Retitled') });
    const storage = memStorage({
      'dscms:titles': JSON.stringify({ 'oid-OLD': { title: 'Stale' } }),
    });
    const { posts } = await loadListing(
      gh,
      storage,
      resolvedOf([post('2026-07-01-first-post.md', 'oid-NEW')], []),
    );
    expect(posts[0]!.title).toBe('Retitled');
    expect(gh.calls).toContain('fetchBlobs:oid-NEW');
  });

  it('degrades to a filename-derived title for binary or title-less blobs', async () => {
    const gh = fakeGh({
      'oid-b': { text: null, isBinary: true, isTruncated: false },
      'oid-n': { text: '---\nlayout: post\n---\n\nB.\n', isBinary: false, isTruncated: false },
    });
    const { posts } = await loadListing(
      gh,
      memStorage(),
      resolvedOf(
        [post('2026-07-01-binary-thing.md', 'oid-b'), post('2026-07-02-no-title.md', 'oid-n')],
        [],
      ),
    );
    expect(posts.map((p) => p.title)).toEqual(['No Title', 'Binary Thing']);
  });

  it('sorts posts by date descending; drafts keep name order', async () => {
    const gh = fakeGh({});
    const storage = memStorage({
      'dscms:titles': JSON.stringify({
        a: { title: 'Older' }, b: { title: 'Newer' }, c: { title: 'B' }, d: { title: 'A' },
      }),
    });
    const { posts, drafts } = await loadListing(
      gh,
      storage,
      resolvedOf(
        [post('2026-01-05-older.md', 'a'), post('2026-07-01-newer.md', 'b')],
        [draft('b-draft.md', 'c'), draft('a-draft.md', 'd')],
      ),
    );
    expect(posts.map((p) => p.slug)).toEqual(['newer', 'older']);
    expect(drafts.map((d) => d.slug)).toEqual(['a-draft', 'b-draft']);
  });

  it('survives a corrupt cache', async () => {
    const gh = fakeGh({ 'oid-1': md('A') });
    const { posts } = await loadListing(
      gh,
      memStorage({ 'dscms:titles': 'not json{' }),
      resolvedOf([post('2026-07-01-a.md', 'oid-1')], []),
    );
    expect(posts[0]!.title).toBe('A');
  });
});

// #12. Every rule asserted here is one the oracle measured against BOTH Jekyll
// 3.10.0 (what GitHub Pages runs) and 4.4.1 — see test/oracle/.
const plain = (text: string) => ({ text, isBinary: false, isTruncated: false });

describe('loadListing: pages (#12)', () => {
  it('front matter decides, not the extension: README.md is not a page', async () => {
    const gh = fakeGh({
      'oid-about': md('About Us'),
      'oid-readme': plain('# Readme\n\nNo front matter here.\n'),
    });
    const { pages } = await loadListing(
      gh,
      memStorage(),
      resolvedOf([], [], '', [file('about.md', 'oid-about'), file('README.md', 'oid-readme')]),
    );
    expect(pages.map((p) => p.path)).toEqual(['about.md']);
    expect(pages[0]!.title).toBe('About Us');
  });

  // The stated blind spot: Jekyll calls a front-matter'd LICENSE a page
  // (measured). The CMS cannot, because finding it means reading every file in
  // the repo. It must not be found by accident either — the omission is
  // deliberate, and MSG.pagesBlindSpot is what makes it honest.
  it('only considers markdown_ext + html candidates, so an extension-less page is missed', async () => {
    const gh = fakeGh({ 'oid-lic': md('License'), 'oid-txt': md('Notes') });
    const { pages } = await loadListing(
      gh,
      memStorage(),
      resolvedOf([], [], '', [file('LICENSE', 'oid-lic'), file('notes.txt', 'oid-txt')]),
    );
    expect(pages).toEqual([]);
    // Never read: not a candidate, so it costs nothing to ignore.
    expect(gh.calls).toEqual([]);
  });

  it('honours the site’s own markdown_ext', async () => {
    const gh = fakeGh({ 'oid-1': md('Custom') });
    const resolved = resolvedOf([], [], '', [file('about.textile', 'oid-1')]);
    resolved.layout.pageExts = ['textile', 'html', 'htm'];
    const { pages } = await loadListing(gh, memStorage(), resolved);
    expect(pages.map((p) => p.path)).toEqual(['about.textile']);
  });

  it('a page with front matter but no title falls back to its filename', async () => {
    const gh = fakeGh({ 'oid-1': plain('---\nlayout: home\n---\n\nHi.\n') });
    const { pages } = await loadListing(
      gh,
      memStorage(),
      resolvedOf([], [], '', [file('getting-started.md', 'oid-1')]),
    );
    expect(pages[0]!.title).toBe('Getting Started');
  });

  it('caches the negative: a non-page is never re-read', async () => {
    const storage = memStorage();
    const first = fakeGh({ 'oid-readme': plain('# Readme\n') });
    await loadListing(first, storage, resolvedOf([], [], '', [file('README.md', 'oid-readme')]));
    expect(first.calls).toEqual(['fetchBlobs:oid-readme']);

    const second = fakeGh({ 'oid-readme': plain('# Readme\n') });
    const { pages } = await loadListing(
      second,
      storage,
      resolvedOf([], [], '', [file('README.md', 'oid-readme')]),
    );
    expect(pages).toEqual([]);
    expect(second.calls).toEqual([]); // the whole point of the fm flag
  });

  // Entries written before the fm flag existed carry a title and nothing else.
  // They must not read as "no front matter" — that would silently hide a page.
  it('re-reads a pre-#12 cache entry once, then self-heals', async () => {
    const storage = memStorage({
      'dscms:titles': JSON.stringify({ 'oid-1': { title: 'About Us' } }),
    });
    const gh = fakeGh({ 'oid-1': md('About Us') });
    const { pages } = await loadListing(
      gh,
      storage,
      resolvedOf([], [], '', [file('about.md', 'oid-1')]),
    );
    expect(pages.map((p) => p.title)).toEqual(['About Us']);
    expect(gh.calls).toEqual(['fetchBlobs:oid-1']);
    expect(JSON.parse(storage.dump()['dscms:titles']!)['oid-1'].fm).toBe(true);
  });

  it('fetches posts and page candidates in ONE batch', async () => {
    const gh = fakeGh({ 'oid-p': md('A Post'), 'oid-a': md('About') });
    await loadListing(
      gh,
      memStorage(),
      resolvedOf([post('2026-07-01-a.md', 'oid-p')], [], '', [file('about.md', 'oid-a')]),
    );
    expect(gh.calls).toEqual(['fetchBlobs:oid-p,oid-a']);
  });

  it('sorts by path and carries the resolved root', async () => {
    const gh = fakeGh({ a: md('Zebra'), b: md('Apple') });
    const { pages } = await loadListing(
      gh,
      memStorage(),
      resolvedOf([], [], 'docs', [file('docs/about.md', 'a'), file('docs/_pages/x.md', 'b')]),
    );
    expect(pages.map((p) => p.path)).toEqual(['docs/_pages/x.md', 'docs/about.md']);
  });

  // #18's truncated degrade hands over an empty sourceFiles: the walk never
  // ran, and pages have no canonical directory to fall back to the way posts
  // do. No pages is the honest answer; MSG.treeTruncated says so out loud.
  it('lists no pages when the tree was truncated', async () => {
    const gh = fakeGh({});
    const { pages } = await loadListing(gh, memStorage(), resolvedOf([], [], '', []));
    expect(pages).toEqual([]);
  });

  it('a binary blob is not a page', async () => {
    const gh = fakeGh({ 'oid-1': { text: null, isBinary: true, isTruncated: false } });
    const { pages } = await loadListing(
      gh,
      memStorage(),
      resolvedOf([], [], '', [file('image.md', 'oid-1')]),
    );
    expect(pages).toEqual([]);
  });
});
