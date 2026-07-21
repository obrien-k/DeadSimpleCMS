# DeadSimpleCMS — Design Document

*Status: phase 1 implemented (`src/`, July 2026). This document holds the product thesis, the shape of the system, and the accepted limits. **The decision log that used to live here is now `docs/adr/`** — one file per decision, with the evidence that produced it. The prototype directories referenced throughout were deleted once their findings landed; the fixtures and Psych oracle live on in `test/`.*

## Thesis

A Git-based CMS for Jekyll sites on GitHub Pages, in the spirit of Decap CMS, with one obsession: **bringing content across the finish line**. A non-technical user writes a post, hits Publish, and watches it go live — with zero git knowledge, zero servers, zero config files. Setup may assume the user can learn to navigate GitHub and GitHub Pages (create a token, click through repo settings), but never git itself.

Constraints:

- **Jekyll-centric, theme-agnostic.** Deep knowledge of Jekyll conventions (`_posts/`, `_drafts/`, front matter, permalinks), zero knowledge of any theme. Must work identically on Minima, Hydejack, or a hand-rolled theme, because it only ever touches content files.
- **Incredibly minimal.** One static admin page. No server, no database, no build service, no hosted account. Hard budget: ~100 kB gzipped total.

## Why this exists

Decap's friction is not at the publish step — its editorial workflow already has a UI Publish button. The real developer dependencies are **server-side OAuth**, a **hand-authored `config.yml`**, and **failure modes expressed in git/CI vocabulary** with nothing closing the loop to say "your post is now live at this URL."

Sharpened: **eliminate the server, eliminate the config, and own the post-publish feedback loop.**

Three differentiators justify a separate project rather than a Decap fork, a Decap backend, or a contribution to Sveltia: **zero-config Jekyll conventions, finish-line publish UX, and guided GitHub Pages setup.** If those evaporate, so does the project.

Full reasoning, including the prior-art survey (Sveltia CMS, Pages CMS) and why the fork and plugin routes were disqualifying: **[ADR-0003](adr/0003-standalone-not-a-decap-fork.md)**.

## Architecture at a glance

**One static admin page. No server. No database. No build service.**

| Concern | Shape | Decision |
|---|---|---|
| Form factor | `/admin/index.html` + vendored `/admin/bundle.js` in the owner's repo | [ADR-0018](adr/0018-vendored-admin-in-repo.md) |
| Install & update | Hosted installer, used once; app commits its own successor | [ADR-0019](adr/0019-hosted-installer-and-self-update.md) |
| Transport | Hard-refuses to run outside a secure context | [ADR-0020](adr/0020-https-only-secure-context.md) |
| Auth | Fine-grained PAT, guided by a template URL, one per editor | [ADR-0004](adr/0004-pat-only-auth.md), [ADR-0005](adr/0005-token-scope-is-unverifiable.md) |
| Finding content | Pages API → source root → `_config.yml` → whole-repo Trees walk | [ADR-0006](adr/0006-resolve-the-jekyll-source-root.md), [ADR-0007](adr/0007-whole-repo-tree-walk-for-posts.md), [ADR-0008](adr/0008-page-identity-by-front-matter.md) |
| Listing | Two-phase GraphQL over an oid-keyed cache | [ADR-0009](adr/0009-graphql-two-phase-listing.md) |
| Writes | Git Data API — atomic multi-file commits | [ADR-0001](adr/0001-git-data-api-for-writes.md), [ADR-0016](adr/0016-conflict-recovery-compare-and-choose.md) |
| Front matter | `yaml` CST API, YAML 1.1 typing, form-order key insertion, inferred fields | [ADR-0002](adr/0002-yaml-cst-for-front-matter.md), [ADR-0010](adr/0010-yaml-1-1-typing.md), [ADR-0011](adr/0011-front-matter-key-insertion-order.md), [ADR-0012](adr/0012-front-matter-field-inference.md) |
| The finish line | Deployments API for success, `build` check-run for failure, sitemap for the URL | [ADR-0013](adr/0013-sitemap-for-live-url-discovery.md), [ADR-0014](adr/0014-build-tracking-and-failure-translation.md), [ADR-0015](adr/0015-undo-is-unpublish.md) |
| Images | Downscaled in-browser, folder inferred, rides the post's commit | [ADR-0017](adr/0017-in-browser-image-downscale.md) |
| Stack & editor | TypeScript + Preact; textarea + live preview | [ADR-0021](adr/0021-stack-preact-and-textarea-editor.md) |

**Decision index with reading order: [`docs/adr/README.md`](adr/README.md).**

### Jekyll-aware, zero config

The conventions the app hardcodes are deliberately few: date-prefixed `YYYY-MM-DD-slug.md` filenames, `_posts/` and `_drafts/` as directory **names**, and a front-matter form (title, date, description, tags, categories, cover image).

Everything else is resolved or inferred:

- **Where those directories are** is resolved per load, never hardcoded — ADR-0006 and ADR-0007. `_posts` is a name, not a path, and `collections_dir`, Pages' `/docs` folder, and a non-default `source.branch` all move it.
- **What counts as a page** is decided by front matter, not extension — ADR-0008.
- **What fields the form shows** is inferred from the site's own recent posts — ADR-0012. No schema file, ever.
- **Where images go** is inferred from the site's existing images — ADR-0017.

Both ADR-0007 and ADR-0008 are measured against **Jekyll 3.10.0 and 4.4.1** — Pages' branch builds run 3.10, an Actions build pins its own. Re-derive any claim with `ruby test/oracle/jekyll-layout-oracle.rb`.

### Setup wizard (first run)

Checks the repo has GitHub Pages enabled and a build workflow. Where the API cannot act with a PAT's permissions, it shows click-here GitHub UI instructions with live verification checks ("✓ Pages is enabled" turns green when done). Whether the wizard could enable Pages itself is an open measurement — issue #41.

## MVP phases

1. **Core loop:** PAT auth → list posts → edit/create → commit → deploy status → verified live link. ✅
2. **Content comfort:** ~~drafts flow~~ (create/publish in phase 1; delete + unpublish landed in #16), ~~image upload + insertion~~ (#14), ~~front-matter inference~~ (#13), ~~conflict handling~~ (#15), ~~one-click revert~~ (#9). ✅
3. **Onboarding:** ~~setup wizard~~ (#29), ~~PAT-expiry reminders~~ (#30), ~~OAuth-for-teams~~ (ruled out of scope, #31), data-file editing (out of scope — PRD in #39).

*Page **editing** landed early (#12): the list view is the front door and had to know how many kinds of thing it holds before the form-fields work could proceed. Page **creation** is still deferred — PRD in #38.*

*The installer is a second build output of this repo: `vite.config.ts` builds the vendored `/admin/` library bundle; `vite.installer.config.ts` builds the installer site to `dist-site/`. Pages for this repo uses GitHub Actions, not deploy-from-branch — see ADR-0019.*

## Deferred and out of scope

| Item | Status | PRD |
|---|---|---|
| Page creation | Deferred — no canonical location to write to | [#38](https://github.com/obrien-k/DeadSimpleCMS/issues/38) |
| Data-file editing (`_data/*.yml`) | Out of scope for MVP | [#39](https://github.com/obrien-k/DeadSimpleCMS/issues/39) |
| Editorial / review workflow | Out of scope — commits go straight to the default branch | [#40](https://github.com/obrien-k/DeadSimpleCMS/issues/40) |
| Wizard enabling Pages via the API | Unmeasured | [#41](https://github.com/obrien-k/DeadSimpleCMS/issues/41) |

## Known risks and accepted limits

**Auth and tokens**

- **PAT lifecycle.** Fine-grained tokens expire within a year. The `github-authentication-token-expiration` header carries the expiry on every call, so warn ahead and treat a 401 as the fallback, not the trigger. Tokens are per-user credentials — never shared.
- **An over-scoped token is undetectable**, and the guarantee rests entirely on the user's dropdown choice. The install-time callout is the only mitigation that exists. The risk is **latent and grows silently**: an "All repositories" token also covers repos created *later*. See ADR-0005.
- **Token storage is `localStorage` on a public site's `/admin/` path**, and `username.github.io` is one origin shared by every project page that user publishes. See ADR-0004.

**Supply chain**

- **Self-update makes this project a supply chain, and nothing available fixes that.** Every install runs the bundle this repo serves, and each carries a `contents: write` PAT. No integrity check helps — a hash shares the bundle's source, and CI-held signing keys fall with the repo. The mitigations are ordinary: protect the repo and the release path, keep updates explicit and user-initiated. See ADR-0019.

**Scale and API limits**

- **The post list has no upper bound**, and ADR-0007's walk widened it to the whole repo tree. Measured: 1.1 kB gzip / 19 entries on a scratch blog, 45.7 kB / 949 entries on `jekyll/jekyll` — the same order, nowhere near the `truncated` cliff (~100k entries / 7 MB), which is now detected and degraded rather than ignored. ADR-0008 extends this to *requests*: cold start costs `ceil(candidates / 100)` parallel blob queries. Bounded per query, unbounded in total; the oid cache makes it once-per-blob, never steady-state.
- **API size limits.** Base64 payloads; ~100 MB/file write ceiling. The 1 MB **read** ceiling on the Contents API applies only to opening a single file in the editor.
- **GraphQL is a second API surface with REST-shaped failure** — errors arrive as HTTP 200 with an `errors` array, and it bills a separate 5,000-points/hr budget. One shared request helper must handle both surfaces, or this bug gets written twice.

**Correctness**

- **The JS `yaml` library and Jekyll disagree about what a file *means*, by default, on every write path.** Verified against real Psych: the library default re-types 10 of 14 sample values and the CST path 11. Both are fixable to zero, but the fix is **per-call-site discipline, not configuration**. Wrap the library once and never call it directly — see ADR-0010 and #10.
- **Unmeasured:** build tracking on an Actions-source repo (ADR-0014), and whether a private site repo needs `Deployments: read` (ADR-0004).

**Scope**

- **No review workflow in MVP.** Commits go straight to the default branch — see #40.

## Verification plan

- Drive the full loop against a scratch `jekyll new` repo with a GitHub Pages workflow — **never a production site**: create draft → edit → publish → watch status → confirm the post is live at the reported URL.
- **Round-trip test:** hand-write a post with exotic front matter (nested keys, comments, odd spacing); open and save it in the CMS; `git diff` must be clean except the intended edits.
- **Unicode test:** a post with emoji and non-Latin text must survive a save byte-identical.
- **Green-build-but-not-live test:** publish a deliberately future-dated post and confirm the UI explains why it isn't live, rather than spinning on a passed build.
- **Theme-agnostic check:** repeat the loop on Minima and on a Hydejack site (read-only browse + one throwaway draft).
- **Budget check:** built bundle ≤ ~100 kB gzipped. Build first — a stale `dist` reports a fictional number.
