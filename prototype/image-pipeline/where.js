// PROTOTYPE — the two decisions above the 4 MB-photo plumbing: where an
// uploaded image lands, and what markdown gets inserted. Pure functions with
// inline assertions so the ugly cases are the test.
//
//   node where.js
//
// Mirrors src/infer/index.ts's posture: read what the site already does, and
// when it does nothing, fall back to ONE stated default rather than a config
// prompt (DESIGN.md "zero config, no schema file, ever").

import assert from 'node:assert';

// --- Where do they go? ------------------------------------------------------
//
// Jekyll has no image convention, so infer the directory the site already
// uses for images and reuse it. The signal is existing image files in the
// repo tree (the REST Trees response #18 already fetches — no new request).
// At N=0 there is nothing to read, so a default is unavoidable; `assets/img`
// is the most common theme convention and, unlike `assets` alone, keeps
// uploads out of the way of CSS/JS.

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const DEFAULT_DIR = 'assets/img';

/**
 * @param {string[]} tree  every blob path in the repo (Trees API, recursive)
 * @returns {{ dir: string, inferred: boolean }}
 */
export function imageDir(tree) {
  const counts = new Map();
  for (const path of tree) {
    if (!IMAGE_EXT.test(path) || !path.includes('/')) continue;
    // Skip Jekyll machinery dirs — a favicon at root or an image inside a
    // theme's own `_sass`/`_includes` is not where the owner puts photos.
    if (path.startsWith('_')) continue;
    const dir = path.slice(0, path.lastIndexOf('/'));
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  if (counts.size === 0) return { dir: DEFAULT_DIR, inferred: false };
  // Most-used existing image dir wins; ties break toward the shallower path,
  // which is the one a human would call "the images folder".
  const [dir] = [...counts].sort(
    (a, b) => b[1] - a[1] || a[0].split('/').length - b[0].split('/').length,
  )[0];
  return { dir, inferred: true };
}

// --- What markdown gets inserted? -------------------------------------------
//
// The body gets `![alt](path)`. Two ways to ship it broken:
//
//  1. baseurl. Jekyll serves a project site under `/repo/`, and a raw
//     `/assets/img/x.jpg` 404s there — the exact class of bug #4 caught in the
//     sitemap. But hardcoding `{{ site.baseurl }}` into the *stored markdown*
//     is worse: it's Liquid in body text, which #12's preview caveat says
//     misrenders, and it rots if the site moves. The site-root-relative path
//     with a leading `/` is what Jekyll's own `{% link %}` resolves against and
//     what themes write by hand; baseurl is applied at SERVE time, not stored.
//     So: store `/assets/img/x.jpg`, never the baseurl-interpolated form.
//
//  2. alt. Empty alt is an accessibility failure; invented alt text is a
//     confident lie about someone's photo. The only honest default is to leave
//     the alt empty and SAY SO in the UI, the same move #12 made for the missed
//     page — the owner writes the real words, we don't fabricate them.

/**
 * @param {string} dir       from imageDir()
 * @param {string} filename  the resized upload's name
 * @param {string} alt       owner-supplied; '' means they left it blank
 */
export function insertionMarkdown(dir, filename, alt = '') {
  const path = '/' + [dir, filename].join('/').replace(/\/+/g, '/');
  return `![${alt}](${path})`;
}

// --- the ugly cases are the test --------------------------------------------

// N=0: brand-new `jekyll new` site, no images anywhere.
assert.deepEqual(imageDir(['_posts/2026-01-01-hello.md', '_config.yml', 'index.md']), {
  dir: 'assets/img',
  inferred: false,
});

// Site already uses assets/img — reuse it, don't invent.
assert.deepEqual(
  imageDir(['assets/img/a.jpg', 'assets/img/b.png', 'assets/css/main.css']),
  { dir: 'assets/img', inferred: true },
);

// Site uses a different convention (`images/`) — honour the site, not our default.
assert.deepEqual(imageDir(['images/cat.jpg', 'images/dog.jpg', 'about.md']), {
  dir: 'images',
  inferred: true,
});

// A theme ships images under `_sass`/root favicon; those must not win.
assert.deepEqual(
  imageDir(['favicon.png', '_includes/logo.svg', 'assets/img/post1.jpg']),
  { dir: 'assets/img', inferred: true },
);

// Insertion: site-root-relative, leading slash, no baseurl Liquid, empty alt honoured.
assert.equal(insertionMarkdown('assets/img', 'ugly.jpg'), '![](/assets/img/ugly.jpg)');
assert.equal(
  insertionMarkdown('images', 'sunset.jpg', 'Sunset over the bay'),
  '![Sunset over the bay](/images/sunset.jpg)',
);
// No doubled slashes if a dir sneaks in a trailing one.
assert.equal(insertionMarkdown('assets/img/', 'x.png'), '![](/assets/img/x.png)');

console.log('where.js: all ugly-case assertions passed');
console.log('  N=0 default:', imageDir([]).dir);
console.log('  example insertion:', insertionMarkdown(imageDir([]).dir, 'ugly.jpg'));
