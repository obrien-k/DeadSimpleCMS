# ADR-0007: Find posts with a whole-repo Trees walk, fenced by Jekyll's own rules

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #18
- **Code:** `src/layout/`
- **Related:** ADR-0006 (the root), ADR-0008 (pages ride this walk)

## Context

ADR-0006 resolves *where* Jekyll reads from, but querying `<base>/_posts` is still a single-directory query against what Jekyll treats as a **recursive scan**. Jekyll reads `_posts` and `_drafts` from **every** directory at any depth, with no config, and the subdirectory flows into the URL. A stock site with `blog/_posts/` is silently half-listed — the same class of silent omission #17 just fixed.

## Decision

Collect posts and drafts from `<base>/**/_posts` via **REST Trees `?recursive=1`**: one call, the whole path list, filtered client-side.

A GraphQL nesting depth was rejected — it is a limit *we* invented, which is #17's silent omission in a new hat.

`postsDirs` / `draftsDirs` are the **read sets** and may be empty. **`writeBase`** is a separate, always-usable write target, because a read set cannot answer "where does a *new* post go" — and a site whose only posts live in `blog/_posts` should get its next one there, not in a directory the app invented.

### The fence

Jekyll's own rules, and only the ones that are version-invariant:

- Prune `_*` and `.*` segments, honouring `include:`.
- Prune the user's **literal** `exclude:` entries.
- **Do not replicate Jekyll's built-in default excludes.**

## Evidence

Measured on **both Jekyll 3.10.0 and 4.4.1** (`test/oracle/jekyll-layout-oracle.rb`):

| Fixture | Read as a post? |
|---|---|
| `_posts/`, `content/_posts/` with `collections_dir: content` | ✅ — and root `_posts/` **ignored entirely** |
| `content/_drafts/` with `collections_dir: content` | ✅ — root `_drafts/` **ignored** |
| `blog/_posts/`, `deep/nested/very/_posts/` — **no config at all** | ✅ — every directory, any depth |
| `_underscore/_posts/`, `.hidden/_posts/` | ❌ — the walk prunes `_` and `.` segments |
| `_included/_posts/` with `include: ["_included"]` | ✅ — **`include:` re-opens an underscore directory** |
| `archive/_posts/` with `exclude: [archive]` | ❌ — a user `exclude:` entry prunes, on both versions |
| `blog/node_modules/_posts/` | ✅ — **`exclude` patterns are root-anchored**, so a bare `node_modules` never prunes a nested one |
| `node_modules/_posts/`, **no `exclude:` key** | ❌ on both — the built-in defaults apply |
| `node_modules/_posts/`, user **sets** `exclude: [unrelated]` | **3.10: ✅ read · 4.4.1: ❌ pruned** — 3.10 *replaces* the default list, 4.x *merges* it (`add_default_excludes`) |

That last row is why the built-in defaults are not replicated: whether they apply depends on the Jekyll version *and* on whether the user wrote an `exclude:` key, and the version is only visible for `build_type: legacy`. The defaults name only `node_modules`, `vendor/{bundle,cache,gems,ruby}`, `Gemfile`, `gemfiles`, `.sass-cache`, `.jekyll-cache` — the dot-prefixed ones are pruned structurally anyway, and none of the rest ever holds a `_posts`. Every rule that *is* honoured behaves identically on 3.10 and 4.4.1, so the fence is version-invariant **by construction**.

Size, measured: **1.1 kB gzip / 19 entries** on a scratch blog; **45.7 kB / 949 entries** on `jekyll/jekyll` (a code repo, not a blog). Same order, nowhere near the cliff.

## Consequences

- **The fence bounds interpretation, not the fetch.** The Trees call is repo-wide regardless. That matters far more for page discovery (ADR-0008), where each candidate costs a front-matter read, than for posts, which are identified by path shape alone. `Resolved.sourceFiles` therefore carries everything walked that is *not* in a magic directory — pages and static files — so ADR-0008 filters it with no further requests.
- **`truncated` is a degrade, not a shrug.** Above ~100k entries / 7 MB GitHub returns a **partial tree** and says only that it did, not what it cut. Deriving from it would ship omission with no symptom, so `postsScan` becomes `'root-only'`: fall back to reading `<base>/_posts` and `<base>/_drafts` directly (exactly the pre-#18 behaviour), say so, and hand ADR-0008 nothing. The realistic way to reach it is a site in `/docs` inside a large monorepo.
- **Two residuals, documented rather than hidden:**
  - **Glob patterns in `exclude:` are ignored** — matching them means reimplementing `File.fnmatch`.
  - A repo committing `node_modules` with a `_posts` inside gets phantom posts. On 3.10 with an `exclude:` key, Jekyll would publish them anyway.
