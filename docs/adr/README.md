# Architecture Decision Records

One file per decision. Each records the context, the choice, the evidence behind it, and what it costs.

Most of these were extracted from `docs/DESIGN.md`'s decision log in July 2026 and carry the measurements that produced them. Where an ADR says "verified" or "measured", the prototype or oracle script is named.

**To supersede a decision:** add a new ADR, set the old one's status to `Superseded by ADR-NNNN`, and leave its text intact. ADRs are a log, not a spec.

| # | Decision | Issue |
|---|---|---|
| [0001](0001-git-data-api-for-writes.md) | Git Data API for writes, not the Contents API | — |
| [0002](0002-yaml-cst-for-front-matter.md) | The `yaml` CST API for front matter, not the AST API | — |
| [0003](0003-standalone-not-a-decap-fork.md) | Build standalone, not a Decap fork or backend | — |
| [0004](0004-pat-only-auth.md) | Fine-grained PAT auth, guided — no OAuth, no worker | #31 |
| [0005](0005-token-scope-is-unverifiable.md) | Token over-scope is undetectable — check the decidable subset | #7 |
| [0006](0006-resolve-the-jekyll-source-root.md) | Resolve where Jekyll reads from — never hardcode `_posts` | #17 |
| [0007](0007-whole-repo-tree-walk-for-posts.md) | Whole-repo Trees walk for posts, fenced by Jekyll's rules | #18 |
| [0008](0008-page-identity-by-front-matter.md) | A page is front matter, found via an extension heuristic | #12 |
| [0009](0009-graphql-two-phase-listing.md) | Two-phase GraphQL listing over an oid-keyed cache | #5, #12, #13 |
| [0010](0010-yaml-1-1-typing.md) | Write YAML 1.1, and force quotes on the CST path | #10 |
| [0011](0011-front-matter-key-insertion-order.md) | Insert new keys in form order, ranked by file position | #6 |
| [0012](0012-front-matter-field-inference.md) | Infer form fields from the 20 most recent posts | #13 |
| [0013](0013-sitemap-for-live-url-discovery.md) | `sitemap.xml` for the live URL, cross-checked against `environment_url` | #4 |
| [0014](0014-build-tracking-and-failure-translation.md) | Deployments API for success, the `build` check-run for failure | #4, #9 |
| [0015](0015-undo-is-unpublish.md) | Undo reverses the publish move — it is not `git revert` | #9, #16 |
| [0016](0016-conflict-recovery-compare-and-choose.md) | `force: false` server-side, compare-and-choose client-side | #15 |
| [0017](0017-in-browser-image-downscale.md) | Downscale in-browser, infer the folder, ride the post's commit | #14 |
| [0018](0018-vendored-admin-in-repo.md) | `/admin/` in the owner's repo, vendored bundle, no CDN | #2, #3 |
| [0019](0019-hosted-installer-and-self-update.md) | Hosted installer used once; self-update with no integrity check | #3, #8, #29 |
| [0020](0020-https-only-secure-context.md) | `/admin/` hard-refuses to run outside a secure context | — |
| [0021](0021-stack-preact-and-textarea-editor.md) | TypeScript + Preact; textarea editor with live preview | — |

## Reading order

New to the project: **0003** (why this exists at all) → **0004** (how auth works without a server) → **0006**–**0009** (how it finds content) → **0013**–**0015** (the finish line, which is the differentiator).

Touching front matter: **0002** → **0010** → **0011** → **0012**, in that order. They build on each other and 0010 is the one that silently corrupts posts if skipped.
