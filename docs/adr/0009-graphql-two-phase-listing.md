# ADR-0009: Two-phase GraphQL listing over an oid-keyed cache

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #5 (listing), #12 (`fm`, batching), #13 (`keys`)
- **Code:** `src/listing/`, `src/gh/`
- **Related:** ADR-0006 (root resolution), ADR-0007 (the walk)

## Context

The originating ticket assumed listing meant reading each post to get its title, and worried about N and about the Contents API's 1 MB read ceiling. Both premises were wrong: there is no per-post read, so there is no N and the 1 MB ceiling never applies to listing.

## Decision

Two phases, over a cache keyed by blob oid.

**Phase 1** — one GraphQL query returns `entries { name oid }` for the resolved posts and drafts directories via aliases. Cost **1**.

**Phase 2** — only on cache misses. Blobs addressed **directly by oid**, one alias each: `b0: object(oid: "…") { ... on Blob { text } }`. Cost **1**.

**Do not ask for `text` in phase 1.**

**Chunk phase 2 into parallel batches of 100.**

Fallback if GraphQL is ever unavailable: Trees API `?recursive=1` — 1 call, paths and shas, with its own `truncated` cliff.

## Evidence

Measured against a 102-post site (`prototype/post-listing/`, July 2026):

- **Phase 1 with `text` is 62.5 kB gzip vs 3.5 kB for `name+oid` — ~17×** — re-downloaded every load to refill a cache that is almost always warm. Both cost 1, so the rate limit does not notice; the user's connection does.
- Phase 2 verified to **102 aliases in one query**, with `nodeCount` 0 — aliased oid lookups do not count against the node limit. A cold start is one query at any realistic post count.
- **200 posts: 1 call / ~7 kB gzip in steady state; 2 calls at cold start.** ~104 B/post.
- **GraphQL costs nothing against the bundle** — a query is a JSON POST, no client library — and bills a **separate 5,000-points/hr** budget rather than REST's 5,000 requests/hr. Fine-grained PATs authenticate to it; CORS verified (`access-control-allow-origin: *`, `Authorization` allowed).

**Blob oids are content hashes, so an `oid → {title, date, draft}` cache in `localStorage` never goes stale.** No TTL, no ETag, no invalidation logic. An edited post is simply a new oid, i.e. a miss. Invalidation is deleted rather than managed.

## Consequences

- **Phase 1 is no longer the app's only call, and no longer the only GraphQL surface.** ADR-0006's root resolution costs a `GET /pages` + `GET /repos` pair, and ADR-0007's walk is REST Trees. Steady state is 2 round trips, always. The trip that used to be free was buying a wrong answer.
- **GraphQL fails in a REST-shaped trap: errors arrive as HTTP 200 with an `errors` array.** A `res.ok` check reads success from a failure — check `body.errors`. One shared request helper must handle both surfaces, or this bug gets written twice.
- **`Tree.entries` has no pagination** (it is not a Relay connection), which is why phase 1 must stay lean — it is the one call that cannot be bounded. A **missing directory is `object: null`, not an error** (a site with no `_drafts/` is normal), which is exactly the silence ADR-0006 was written to stop misreading.
- **`Blob.text` is `null` for binary.** `isBinary` / `isTruncated` ride the same response, so the list explains itself and falls back to a filename-derived title rather than breaking.
- **Batches of 100** is the number with evidence behind it. #5 verified 102 aliases when the only callers were two directories; ADR-0008 unbounds the candidate set to every markdown file under the root, which a docs-heavy site counts in thousands. Where an aliased query actually breaks is unmeasured, so the batch is not a probe for the cliff. Cold start costs round trips, not sequence; steady state is still zero.
- **One cache, extended twice, never forked.** `CacheEntry` carries `fm?: boolean` (ADR-0008) and `keys?: KeyShapes` (ADR-0012) on identical terms: each is a pure function of the same content hash, so `undefined` means "never asked" and older entries re-read once and self-heal. Two oid-keyed caches could disagree about which blobs they have seen.
- **The cache holds only listing metadata** — already-public content. Never the token, never draft bodies.
- **The post list has no upper bound.** `Tree.entries` is not paginated and the Trees API has no pagination either, so the listing is whatever the repo holds, growing forever with no mechanism to bound it. Revisit if a site ever gets absurd.
- **Reading one file** (opening the editor) uses the Contents API, whose 1 MB inline ceiling applies only there — above it, GitHub returns metadata with no content and the Blobs API or the raw media type is required. That is a read limit, distinct from ADR-0001's ~100 MB write limit.
