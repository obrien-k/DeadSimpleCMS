# ADR-0006: Resolve where Jekyll reads from — never hardcode `_posts`

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #17
- **Code:** `src/layout/`
- **Related:** ADR-0007 (the walk), ADR-0009 (listing)

## Context

`_posts` is a directory *name*, not a path. Phase 1 assumed otherwise and issued one hardcoded `HEAD:_posts` query.

That fails **silently**. A missing directory comes back as `object: null`, indistinguishable from an ordinary site with no drafts — so a site served from `/docs` got an empty post list with no explanation, and its publishes landed where Jekyll never reads.

Three things relocate the content:

- **GitHub Pages' source folder** (`/docs` vs root).
- **`collections_dir`** in `_config.yml`, which moves posts *and* drafts.
- **The branch.** `source.branch` need not be the default branch.

## Decision

Resolve **one root** per load, and hang every path off it:

```
{ branch, sourceRoot, postsDirs, draftsDirs, writeBase, basis, postsScan }
```

Ordering is forced: `collections_dir` lives *in* `_config.yml`, but `_config.yml` lives at the source root, which is the thing being resolved. So **`GET /pages` → source root → `<root>/_config.yml` → `collections_dir`**.

### The resolution ladder

| Condition | Resolves to |
|---|---|
| `GET /pages` ok, `build_type: legacy` | `source.branch` + `source.path` (`basis: 'pages'`) |
| `GET /pages` ok, `build_type: workflow` | default branch + root, **stated** |
| `GET /pages` → `null` | default branch + root, **stated** (`no-pages` / `pages-unreadable` per `private`) |
| No `_config.yml` **and** no `_posts/` at the root | **`LayoutError` — say so, refuse to list** |

Row 2 does not parse `.github/workflows/*.yml`: a workflow decides the source, so `source.path` is not in play, and the workflow schema is unbounded and not ours.

The evidence test in row 4 accepts `_config.yml` **or** `_posts/`, because Jekyll builds fine with no `_config.yml` (Pages supplies defaults), so gating on the config alone would reject valid sites.

Rows 2–3 degrade to exactly phase 1's behaviour — default branch, root. The difference is that the app now *says* it assumed.

## Evidence

Measured against the live API and against **both Jekyll versions in play** (July 2026). GitHub Pages' branch builds run **Jekyll 3.10.0** ([github-pages gem 232](https://pages.github.com/versions/)), not 4.x, and that is exactly the `build_type: legacy` case where `source.path` is authoritative. An Actions build pins its own. Re-derive any claim with `ruby test/oracle/jekyll-layout-oracle.rb`.

- **`_config.yml`'s own `source:` key is inert on GitHub Pages.** GitHub [documents it as overridden](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll) (`source: [your repo's top level directory]`, alongside `safe`, `lsi`, `incremental`, `highlighter`). The Pages API is the only authority on the root. `collections_dir` is **not** on that override list and is honoured.
- **`collections_dir` moves drafts exactly as it moves posts.** With `collections_dir: content`, root `_posts/` and root `_drafts/` are both ignored entirely.
- **The branch moves too.** Measured: `jekyll/jekyll` builds from `gh-pages` while its default branch is not `gh-pages`. A publish to the default branch there never goes live.
- **`GET /pages` requires authentication.** A public repo with Pages 404s anonymously, so the documented "works without authentication for public resources" waiver is false for anonymous requests. It does hold for tokens: a fine-grained PAT with `Contents: read` and nothing else returned 200 on both `jekyll/jekyll` and a scratch repo — **on a public repo, no `Pages: read` scope is needed.** That measurement does not extend to private repos, which is why `src/app/token.ts` still requests `pages: read`.
- **A 404 from `GET /pages` has two causes GitHub refuses to distinguish**: Pages is off, or the repo is private and the token lacks `Pages: read`. `private` (already on the `GET /repos` response) separates them. Reporting the second as the first tells a paying user their live site is switched off.

## Consequences

- **Cost: 2 round trips, always.** A `GET /pages` + `GET /repos` pair, then a `_config.yml` read and the REST Trees walk **in parallel** — the tree is repo-wide, so `collections_dir` only re-filters it rather than forcing another trip. The free trip phase 1 enjoyed was buying a wrong answer.
- **Not cached.** The layout is resolved fresh per load. The oid cache (ADR-0009) is safe because oids are content hashes, so staleness is structurally impossible; a layout cache has no such key and would be the first cache here needing *management*, holding the one value whose staleness reproduces the bug. Two requests against a 5,000/hr budget is the cheaper side of that trade.
