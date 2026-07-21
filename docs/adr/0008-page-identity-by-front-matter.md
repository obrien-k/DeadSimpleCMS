# ADR-0008: A page is front matter — found via an extension heuristic, with the blind spot stated

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #12
- **Code:** `src/listing/`
- **Related:** ADR-0007 (rides its walk), ADR-0009 (rides its cache), ADR-0012 (a page's form)

## Context

The list view is the front door and had to know how many kinds of thing it holds before the form-fields work could proceed. So: what is a page, without a schema file?

## Decision

**Front matter decides**, applied over an **extension-heuristic candidate set** drawn from ADR-0007's walk. Candidates are the site's own `markdown_ext` (read from `_config.yml`, never hardcoded — a site that renames it stops rendering `.md`) plus `.html`/`.htm`.

The blind spot is **stated in the UI**, not buried: `MSG.pagesBlindSpot` says on the list that an extension-less page with front matter cannot be seen. #5 rejected slug-only titles because *the list would lie*; an omission the user is never told about is the same lie.

Three further calls:

- **No content-vs-machinery distinction.**
- **No page creation.**
- **Truncated tree ⇒ no pages at all.**

## Evidence

Measured on **both 3.10.0 and 4.4.1** (`test/oracle/jekyll-layout-oracle.rb`, same fixtures as ADR-0007 — posts and pages are two filters over one walk):

| Fixture | Jekyll's verdict |
|---|---|
| `about.md`, `contact.markdown`, `sub/deep/deep.md` | **page** — any depth |
| `README.md` (no front matter) | **static file** |
| `LICENSE` (no extension, *has* front matter) | **page** |
| `notes.txt` (has front matter) | **page** |
| `feed.xml`, `robots.txt` (empty `---\n---`) | **page** — empty front matter is still front matter |
| `style.css` | static file |
| `_pages/inc.md` | page **only** with `include: ["_pages"]` (minimal-mistakes' pattern) |
| `_portfolio/w.md` with `collections:` | **neither** — a third kind |
| `markdown_ext` default (both versions) | `markdown,mkdown,mkdn,mkd,md` |

**Front matter is the only rule, and extension is irrelevant.** Identity lives *inside* the file, so no tree listing can decide it. Applied honestly that means reading *every* file in the repo — #5's "17× the bytes" mistake with no directory to bound it. Hence the heuristic.

The heuristic does an unplanned favour: `feed.xml`, `robots.txt`, and `sitemap.xml` are all genuinely pages to Jekyll, and all three drop out **by extension**, leaving essentially `index.*` and `404.html` as the machinery in scope.

## Rationale for the three sub-decisions

**No content-vs-machinery distinction.** Jekyll has no such concept to read, so any taxonomy would be one the app invented — the thing "Jekyll-aware, zero config" forbids. Owners legitimately edit `index.md`. The real hazard is that its body is Liquid and **`marked` renders `{% include %}` as literal text**, so the preview lies about a file the writer is about to trust. `{%` / `{{` in the body is a *measurable fact* rather than a category, so the editor warns and caveats the preview instead. The textarea is safe regardless: the body round-trips byte-for-byte.

**No page creation.** `pickWriteBase` can place a *post* because `_posts` is canonical — Jekyll defines it. Pages have no equivalent: `about.md`, `_pages/about.md`, and `pages/about.md` are equally valid, and **nothing in `_config.yml` declares which this site uses**. Every existing page has already answered the question by existing; only creation has to guess, and on a themed site it guesses wrong. Deferred — the honest version infers the convention from where the site's current pages live.

**Truncated ⇒ no pages at all.** Posts degrade to `<base>/_posts` because that directory is canonical. "Root-level pages only" is canonical to nothing — it is a depth cap of 1, the invented limit this ticket already rejected once. So the Pages section is absent and `MSG.treeTruncated` says pages cannot be listed, rather than letting a whole section vanish quietly.

## Consequences

- **The cache learns the negative.** `CacheEntry` gains `fm?: boolean`, because `title: ''` cannot distinguish "no front matter" (not a page) from "front matter without a title" (a page — humanize the filename). "README.md is not a page" is correct forever, since oids are content hashes, so it is cached and never re-read. A missing flag means "never asked", so pre-#12 entries re-read once and self-heal: no key bump, no migration, nothing thrown away.
- **Cold start now costs requests, not just bytes.** Every markdown file under the source root is a candidate needing a front-matter read, so a cold start costs `ceil(candidates / 100)` parallel blob queries where it once cost one. See ADR-0009 on batching. The oid cache makes this a once-per-blob cost, never a steady-state one.
- The front-matter read *is* the title read the list needed anyway, so pages cost no extra request beyond the widened candidate set.
