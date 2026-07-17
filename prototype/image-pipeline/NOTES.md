# Prototype: image upload — the ugly photo (#14)

**Status: answered AND absorbed into `src/image/` + `src/gh/` + the Editor.**
Kept as the canvas-behaviour rig: `downscale` runs in no test runner here (node
has no `createImageBitmap`/`OffscreenCanvas`), so `harness.html` + `fixtures/`
are the only way to re-verify the 24× shrink / orientation / GPS-strip claims.
Delete once that behaviour has another home.

## Question

Where do uploaded images go, and what happens when someone drops in a 4 MB
phone photo? (issue #14) The plumbing — image + post in one commit — was
already proved by `prototype/git-data-move/`. Everything undecided is above it.

## How this was measured

- `make-fixture.py` builds `fixtures/ugly.jpg`: **4000×3000, 5.92 MB, EXIF
  Orientation=6 (stored landscape, displays portrait), GPS pointed at a house.**
  A photo-ish gradient + noise + hard edges, because a flat swatch compresses to
  nothing and makes every size number a lie.
- `resize.js` is the native downscale path, written as it would ship.
- `size.js` bundles it the way `scripts/budget.js` measures the app.
- `harness.html` + Playwright ran the path against the fixture in a real
  Chromium and parsed the output JPEG's segments.

## Verdict

### What happens to the 4 MB photo: resize in-browser, and it's nearly free

- **Budget: 275 B gzip.** The native path (`createImageBitmap` +
  `OffscreenCanvas` + `convertToBlob`) is 367 B raw / **275 B gzip** — 0.27 kB
  of the ~41 kB headroom. The #14 worry that "a real encoder is not cheap" does
  not apply, because there is no encoder to ship: the browser's is used. This
  removes the only budget argument for uploading raw.
- **Result: 5.92 MB → 239 kB, a 24× shrink, 1200×1600 px**, at long-edge cap
  1600 / JPEG quality 0.82. Encode ran 0.5–2 s headless; fine for a one-off
  upload. Committing the 5.92 MB raw would put it in git history **forever** —
  the one-way door #14 named — so resize wins on the merits, not just size.
- **Orientation is honored, and for a stronger reason than expected.** Chromium's
  `createImageBitmap` **auto-orients even with no option set** — the raw call
  returned 3000×4000 (portrait), not the stored 4000×3000. The pipeline still
  passes `{ imageOrientation: 'from-image' }` explicitly, because that guarantee
  is not universal across browsers. Output is upright 1200×1600. The classic
  sideways-render bug does not happen here.
- **EXIF, GPS included, is stripped — cleanly and totally.** The input carries
  `APP1(Exif)` with a GPS IFD; the re-encoded output has **no APP1 segment at
  all** (only an `APP0` JFIF and an `APP2` ICC profile Chrome adds). So the
  owner's home address never reaches the public repo. This is a **side effect of
  re-encoding, not code we wrote** — which is exactly why #14 calls it "silent."
  With resize as the default path, the privacy win is free and automatic; the
  decision left is only whether to *tell* the owner it happened.

**The remaining honest tension #14 raised:** resize is lossy and the original
never reaches the repo. For the target persona (a git-averse blogger) this is
invisible and correct. A photographer would call it a bug — but they are not
this product's user, and serving them means shipping full-res into permanent git
history for everyone. Resize is on the right side for this persona.

### Where do they go: infer the site's dir, default to `assets/img` at N=0

`where.js` (`imageDir`): reuse the directory the site already puts images in —
read from the REST Trees response #18 already fetches, so **no new request**.
Most-used existing image dir wins; `_`-prefixed machinery dirs and root
favicons are excluded so a theme's own assets don't hijack the answer.

**At N=0** (a fresh `jekyll new` has zero images, so there is nothing to read)
one default is unavoidable — `assets/img`, the most common theme convention,
and unlike bare `assets/` it keeps uploads clear of CSS/JS. This is the same
posture as `src/infer/` (#13): read what the site does; when it does nothing,
one *stated* default, never a config prompt.

### Insertion: `![alt](/dir/file)`, site-root-relative, empty alt surfaced

`where.js` (`insertionMarkdown`):

- **Path is site-root-relative with a leading `/`** (`/assets/img/ugly.jpg`).
  **Do NOT bake `{{ site.baseurl }}` into the stored markdown** — that is Liquid
  in body text, which #12's preview caveat says misrenders, and it rots if the
  site moves. Jekyll applies baseurl at serve time against the leading-slash
  path; storing the interpolated form is the #4 sitemap bug transplanted into
  post bodies.
- **Alt text defaults to empty and the UI must say so.** Empty alt is an
  accessibility failure; *invented* alt text is a confident lie about someone's
  photo. Honest default: leave it blank, surface it in the UI (the move #12 made
  for the missed page), let the owner write the real words.
- **Cover image (`image.path`)** is already a phase-1 form field (#13) — the
  upload feeds that existing call site, it doesn't invent a new one.

## What should land in `src/`

- An `image/` module: `downscale` (from `resize.js`, native path, ~0.3 kB),
  `imageDir` + `insertionMarkdown` (from `where.js`).
- Wire the upload to write the resized blob + the post in one Git Data commit
  (the mechanism `git-data-move` already proved).
- UI: state that alt is empty and must be filled; optionally note that location
  data was removed on upload (the strip is automatic; the disclosure is a
  choice).

## Corrections / notes for the map

- #14 asks "resize or raw?" as open. **Decided: resize** — the budget objection
  (275 B) and the permanent-git-history objection both point the same way, and
  the persona seals it.
- The naive 2-byte EXIF scan false-positives on JPEG entropy (`hasGps` true on a
  file with no Exif segment at all). Segment parsing is the only honest check —
  `harness.html` and the Playwright probe both do it now.
