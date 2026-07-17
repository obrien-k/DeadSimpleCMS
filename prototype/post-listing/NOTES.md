# Prototype: post listing

**Status: answered. Delete this directory once the findings land in the real code.**

## Question

#5: the list view needs every post in `_posts/` and `_drafts/` with enough metadata to
render (title, date, draft/published). How does it get them, and what does a
200-post site cost?

Run against `obrien-k/deadsimplecms-scratch` (public, 13 posts) for the token path,
and `jekyll/jekyll`'s `docs/_posts` (public, **102 real posts** of long release
notes) for scale — a read-only third party, so nothing gets polluted to measure it.

## Verdict: two calls at cold start, **one forever after** — and the ticket's premise was wrong

**#5 assumed a per-post read exists.** It weighed Trees-vs-Contents and concluded
"reading every post to extract titles is N calls and hits the 1 MB inline read
ceiling." **Neither REST option is the answer, and there is no N.** GitHub's GraphQL
API returns filename, blob oid, and full text for every post in **one request at
cost 1**, and blob oids are content hashes, which makes the cache self-invalidating.

| what | calls | bytes (200 posts, extrapolated) |
|---|---|---|
| steady state (oids all cached) | **1** | ~20 kB raw / **~7 kB gzip** |
| cold start / cache cleared | **2** | + ~340 kB raw / ~122 kB gzip |
| one new post since last load | **2** | + ~2 kB |

**The rate-limit framing in the ticket is also off.** GraphQL bills a *separate*
5,000-**points**/hr budget, not REST's 5,000 requests/hr. Every query here costs
**1**. Listing is not where the budget goes.

## 1. The blocking question: fine-grained PATs work on GraphQL

Never tested by this project before, and everything else depended on it.

```
viewer query -> 200 authenticated
rate limit: 4954/5000 (points — separate budget from REST)
```

**`POST /graphql` is browser-reachable**: preflight → `204`, `access-control-allow-origin: *`,
`POST` in allow-methods, `Authorization` in allow-headers. And it needs **no client
library** — a GraphQL query is a JSON POST — so it costs **nothing against the ~100 kB
budget**, which matters given the round-trip prototype already spent ~30 kB on `yaml`.

## 2. Two-phase, because "one query with the text" is a trap

The obvious query asks for `text` inline and gets everything in one call. **Measured, it
is the wrong default:**

```
102 posts, name+oid+text : 174.6 kB raw,  62.5 kB gzip   (1752 B/post)
102 posts, name+oid      :  10.4 kB raw,   3.5 kB gzip   ( 104 B/post)
```

**~17× the bytes** — to refill a cache that is warm almost every load. So split it:

1. **Lean listing** — `entries { name oid }` over `_posts` and `_drafts` via two aliases
   in one query. Cost 1. This is the *only* call in steady state.
2. **Diff oids against the cache.** Misses only → one follow-up that addresses blobs
   **directly by oid**, one alias each:

```graphql
{ repository(owner: O, name: R) {
    b0: object(oid: "c40729e…") { ... on Blob { text } }
    b1: object(oid: "8ae9274…") { ... on Blob { text } } } }
```

**Verified to scale: 102 aliases in one query → 102 blobs, cost 1, `nodeCount` 0, ~9 kB
of query text.** Aliased `object(oid:)` lookups do not count against the node limit, so
a cold start is one query at any realistic post count. (A chunking fallback exists if a
query-size limit shows up far above 102; not reached here.)

## 3. Content-addressing is the whole decision

Blob oids are **content hashes**, so a cached `oid → {title, date, draft}` entry is
valid *forever*. No TTL, no ETag, no staleness logic, no invalidation bugs — the
class of bug is deleted rather than managed. An oid that reappears is byte-identical
by definition; an edited post is simply a new oid, i.e. a miss.

Cache in `localStorage`, keyed by oid. Per #3's threat-model note `localStorage` is
**origin-keyed and ignores the path**, so `/admin/` shares it with every page on the
Pages origin. **Fine here, and worth saying out loud rather than leaving the reader to
wonder: post titles are already public content.** The cache leaks nothing the site
does not publish. It must therefore hold **only** listing metadata — never the token,
never draft bodies.

## 4. Where it degrades

- **`Blob.text` is `null` for binary**, verified on real PNGs (840 B → 68 kB, all
  `isBinary: true`, all `text: null`; an SVG returns text fine at 4 kB). A `.md` post
  reaches this only via something pathological like a huge embedded data-URI. **It is
  not a mystery when it happens** — `isBinary`/`isTruncated` ride the *same* response,
  so the list can say why and fall back to a filename-derived title. Degrade, don't break.
- **A missing directory is `object: null`, not an error.** A site with no `_drafts/`
  is normal and must not surface as a failure. Confirmed.
- **`Tree.entries` is not a Relay connection — there is no pagination.** No `first`,
  no `after`. The response is whatever the directory holds. This is why phase 1 must
  stay lean: it is the one call that cannot be bounded.

## 5. Date is free from the path — for posts, not drafts

`_posts/YYYY-MM-DD-slug.md` is a hard Jekyll convention, so **date and slug parse out of
the filename with no read at all**. The lean query alone can render a complete, correctly
sorted list of published posts *before* any title resolves.

**`_drafts/` filenames carry no date** — that is the entire point of `_drafts/`. Draft
dates exist only in front matter, i.e. only in phase 2. So the two directories have
genuinely different cold-start behaviour, and the list UI has to decide how a
dateless, not-yet-resolved draft sorts. **Left to the spec.**

## 6. Rejected

- **Contents API per directory** (#5's candidate) — one call per directory and still no
  front matter. Strictly worse than the lean query, which also carries oids.
- **Trees API `?recursive=1`** — a fine REST fallback (1 call, paths + shas), but it walks
  the *whole repo* to read two directories, and has its own cliff: a `truncated` flag
  above ~100k entries / 7 MB. Keep as the fallback if GraphQL is ever unavailable.
- **Per-post reads to extract titles** — the N the ticket worried about. Never needed.
- **Tarball** (`GET /repos/{o}/{r}/tarball`) — `DecompressionStream('gzip')` is native in
  the browser, but tar parsing is not, so it spends bundle on a problem GraphQL solves
  for free, and downloads the entire repo including images.
- **Slug-derived titles only** — 1 call forever and no cache, but the list *lies*:
  `2026-07-16-my-post.md` renders as "My Post" when the real title is
  "My Post: A Deeper Look". Survives as the *placeholder*, not the answer.

## Methodological note: the public-repo false pass, and GraphQL's half-immunity

Fourth appearance. `deadsimplecms-scratch` is **public**, so the PAT's 200 proves nothing
about scope — the trap that nearly produced wrong conclusions in #7 and #4.

**GraphQL is immune to half of it**, and the half matters:

```
anonymous GraphQL on the same public repo -> 403 (rejected)
```

Unlike REST, GraphQL **rejects anonymous callers even for public data**. So a 200 *does*
prove the token authenticated — that much is real evidence, unlike a REST 200. It still
proves **nothing about scope**: any valid token, scoped to any repo, reads a public repo's
contents.

Consequence, same as #4: whether a **private** site repo needs anything beyond
`contents: read` for GraphQL is **unknown**. Does not block the MVP (Pages' free tier
requires public), but the permission list must not be called verified.

## Corrections for DESIGN.md

- **`:102` is wrong.** "Reads use the Contents API to list `_posts/` and `_drafts/`" — no.
  Listing is the GraphQL two-phase read above.
- **The 1 MB Contents read ceiling is no longer the listing constraint.** It survives only
  for the single-file editor read path. It was documented as "the one that actually bites";
  for listing, it never bites, because listing never uses Contents.
- **GraphQL is a second API surface, and it fails in a REST-shaped trap**: errors arrive as
  **HTTP 200 with an `errors` array**. A `res.ok` check reads success from a failure. Any
  shared client must check `body.errors`, not the status.

## Run it

```
TOKEN_FILE=/path/to/token REPO=owner/scratch node probe.js
```

Optional: `SCALE_REPO=owner/name SCALE_PATH=path/to/_posts` (defaults to
`jekyll/jekyll` / `docs/_posts`). Read-only and idempotent — no writes, nothing to reset.
Never prints the token; reports kind and length only.
