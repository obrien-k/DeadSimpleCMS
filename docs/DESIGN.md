# DeadSimpleCMS — Design Document

*Status: phase 1 implemented (`src/`, July 2026). This document is the design record and decision log; the prototype directories it references were deleted once their findings landed — the fixtures and Psych oracle live on in `test/`.*

## Thesis

A Git-based CMS for Jekyll sites on GitHub Pages, in the spirit of Decap CMS, with one obsession: **bringing content across the finish line**. A non-technical user writes a post, hits Publish, and watches it go live — with zero git knowledge, zero servers, zero config files. Setup may assume the user can learn to navigate GitHub and GitHub Pages (create a token, click through repo settings), but never git itself.

Constraints:

- **Jekyll-centric, theme-agnostic.** Deep knowledge of Jekyll conventions (`_posts/`, `_drafts/`, front matter, permalinks), zero knowledge of any theme. Must work identically on Minima, Hydejack, or a hand-rolled theme, because it only ever touches content files.
- **Incredibly minimal.** One static admin page. No server, no database, no build service, no hosted account. Hard budget: ~100 kB gzipped total.

## Premise correction: where Decap's friction actually is

The instinct is that Decap fails at the *publish* step — that pushing content live needs git knowledge. It doesn't: Decap's editorial workflow already gives a UI Publish button that commits/merges via the GitHub API. The real developer dependencies are elsewhere:

1. **Auth.** Decap's GitHub backend requires a server-side OAuth client — historically Netlify's shared service (unreliable since the community handoff), otherwise a self-hosted worker/lambda. A static GitHub Pages site cannot host one, so every install needs a developer to stand up auth infrastructure.
2. **Setup.** A hand-authored `config.yml` defining collections, fields, and widgets. Developer-shaped work before the first post can be written.
3. **Failure modes.** Build breaks, YAML syntax errors, and edit conflicts surface in git/CI vocabulary. And no tool closes the loop: nothing tells the writer "your post is now live at this URL."

So the thesis, sharpened: **eliminate the server, eliminate the config, and own the post-publish feedback loop.**

## Why standalone — not a Decap fork, not a Decap plugin

### Fork Decap?

*Pros:* full widget set, editorial workflow, i18n, media library, a config format people know, existing ecosystem.

*Cons — disqualifying:*

- It is a large legacy React/Redux monorepo (dozens of packages, multi-MB bundle, mid-flight Slate→Plate editor migration). "Incredibly minimal" would mean gutting it, i.e. a rewrite wearing a fork's maintenance burden.
- Upstream development slowed materially after Netlify handed the project to the community (now agency-led). A fork tracks a slow-moving upstream while diverging on architecture — the worst of both.
- The friction being fixed (server-required auth, config-first setup) is architectural, spread through core. It's not a patch; it's a redesign.

### Decap plugin / custom backend?

*Pros:* in theory the least code — auth lives in the backend layer, so a PAT-based backend is the "right" seam; reuses the entire Decap UI; potentially upstreamable.

*Cons — disqualifying:*

- Decap has **no finalized or documented custom-backend API** (decap-cms issues #1601, #6526). A custom backend means reverse-engineering the internal class interface from the GitHub backend's source, with no stability contract.
- Even a perfect zero-server backend still ships Decap's bundle weight and `config.yml` complexity. Setup stays developer-shaped, which violates the core goal.
- The finish-line UX (deploy status, verified live link) has no extension point at all. It would need core patches — which is forking again.

### Prior art: steal from it, don't re-fight it

- **Sveltia CMS** (github.com/sveltia/sveltia-cms) — the modern Decap-compatible rewrite and the de-facto successor. Already does serverless **PAT sign-in**, including a token-page deep link with the required scopes preselected — steal that flow wholesale, but note it predates GitHub's fine-grained template URLs (August 2025) and targets the *classic* token page; see the auth section for the fine-grained equivalent this design uses instead. Plans to drop its optional auth worker once GitHub ships client-side PKCE. But it remains `config.yml`-driven and SSG-agnostic: no zero-config Jekyll awareness, no deploy feedback. Sveltia is the quality bar, not the competition.
- **Pages CMS** (pagescms.org) — the closest target *UX* (non-technical editors, GitHub App auth, invite-by-email) but the wrong shape: a hosted service, with Postgres + a GitHub App required to self-host. It proves the demand exists; it is not minimal.
- **Honest fallback:** if during the build the itch turns out to be fully scratched by Sveltia plus a setup wizard, contribute there instead. The differentiators that justify a separate project are exactly three: zero-config Jekyll conventions, finish-line publish UX, and guided GitHub Pages setup. If those evaporate, so does the project.

## Architecture

**One static admin page. No server. No database. No build service.**

### Form factor

One HTML file at `/admin/index.html` in the user's site repo, loading a **vendored** bundle committed beside it at `/admin/bundle.js` — no CDN, nothing fetched from a third party at runtime. The page is excluded from Jekyll layout processing (front-matter-free HTML passes through untouched). It works on any theme because it never touches the theme — it only reads and writes content files via the GitHub API.

**`index.html` is the config anchor; `bundle.js` is the only replaceable part.** `index.html` carries the `owner/repo` config line and is written *only* by the installer. Self-update rewrites `bundle.js` alone, so the identity the app was installed against cannot drift underneath it.

**`/admin/` hard-refuses to run outside a secure context.** A page served over plain HTTP can be MITM'd and handed a token-stealing script, which makes every other defence here theatre — the API calls being HTTPS is irrelevant once the attacker is running *in the page*. The setup wizard must verify **Enforce HTTPS** is on and block until it is: GitHub cannot enforce HTTPS on a custom domain until its certificate provisions, so "built, but plain HTTP" is a real state a real user hits while waiting.

### Install and update

- **Install: a hosted installer page, used once.** Paste PAT + repo; it commits `/admin/` via the API. This is chosen over a zip-drag install because of repo identity: a wrong config line is a hard error with no override, so any flow where the owner *hand-types* `owner/repo` manufactures exactly that fatal case. An API-based installer writes the line correctly by construction, deleting the failure mode rather than documenting it. It must hold the PAT **in memory only** — never `localStorage`/`sessionStorage` — as it is hosted on a `github.io` origin shared with other project pages.
- **This does not breach "no central service to run or trust."** That rule is about *runtime*, and at runtime there is still nothing but the owner's own repo. The installer is a static page, used once, never contacted again, and introduces no new trust party — it is the same authors whose bundle you are installing regardless.
- **Update: the app commits its own successor.** It already holds `contents: write`. The new bundle is fetched **unauthenticated** from the public project repo via `api.github.com`, which sends `access-control-allow-origin: *` — verified. No CDN is needed for this, which is the last argument for one gone.
- **Update integrity: none is possible. Self-update means trusting this project's repo, and that is stated rather than dressed up.** Two designs were considered and rejected as security theatre. A **hash check** is circular: bundle and hash share a source, so a compromised source serves a matching hash. A **TOFU signature chain** (public key pinned in `index.html`, each version verifying the next) only helps if the private key lives somewhere GitHub cannot reach — and this project would sign in CI, where an attacker holding the repo can read the secret or simply trigger the signing workflow. It would prove "this came through our CI", not "the maintainer approved it", which is precisely the claim a repo compromise falsifies. Cost without benefit. **The honest statement:** every install runs code this repo serves, so a compromise here reaches every install that clicks update. That is the deal with any self-updating software; the mitigation is the update being explicit and user-initiated, never silent.
- **The installer is also the repair tool.** A bad update can brick the only tool a git-averse owner has to fix it, so the installer stays reachable: point it at the repo again and it reinstalls a known-good `/admin/` and re-roots trust. Keeping the N-1 bundle committed was rejected — recovery would mean flipping a reference in `index.html`, the exact git operation the owner cannot perform.
- **Prerequisite:** the project repo must be **public** before either the installer or self-update can work.

### Auth: fine-grained PAT, guided

- Fine-grained GitHub personal access token, scoped to the one site repo. Permissions: Contents read/write, Actions read, Pages read, Metadata read. **This set is not verified.** The finish-line prototype reads `/deployments` successfully with it — but the scratch repo is *public*, and an unauthenticated request reads `/deployments` and `/actions/runs` just as well, so that success proves only that the repo is public (the same false pass documented in the token-scope section). Whether a **private** site repo needs `Deployments: read` — not requested here — is untested. Not MVP-blocking: Pages' free tier requires public.
- Guided creation via a **template URL** that pre-fills the token form, paste once, stored in `localStorage`.
- **Verified (July 2026).** GitHub shipped template URLs for fine-grained PATs in [August 2025](https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/). The form accepts `name`, `description`, `target_name` (user or org slug), `expires_in` (1–366, or `none`), and one parameter per permission. Ours:

  ```
  https://github.com/settings/personal-access-tokens/new
    ?name=DeadSimpleCMS
    &description=Lets+DeadSimpleCMS+publish+posts+to+your+site
    &target_name={owner}
    &expires_in=366
    &contents=write
    &actions=read
    &pages=read
  ```

  `{owner}` is known by the time we ask, so the link is built at runtime. `metadata=read` is implicit — GitHub mandates it whenever other repository permissions are requested. Prefer a real `expires_in` over `none`: a non-expiring token on a public site's `/admin/` is a liability, and PAT-expiry reminders are already a phase-3 item.

- **The one step the URL cannot pre-fill is repository selection.** There is no `repositories` or `repository_ids` parameter; scoping the token to the single site repo stays a manual dropdown choice. That step is exactly the one that enforces the per-repo scoping above, so the UI must call it out explicitly ("choose **only** {repo} under Repository access").
- **That dropdown is the only enforcement point — an over-scoped fine-grained token cannot be detected afterwards.** Prototype-verified (`prototype/token-scope/`, July 2026); this is a real, accepted hole, not an oversight. A token scoped to *all* repos is indistinguishable from a correctly-scoped one when probed against the site repo: `permissions` reports the **user's role**, not the token's grant (byte-identical across two tokens on two accounts), and a write probe succeeds in both cases. Breadth is only visible by proving the token *cannot* reach some *other* repo — and a fine-grained PAT **cannot enumerate private repos** (`/user/repos` returns public repos only, regardless of scope), so the app can never discover a repo to test against. The probe works; discovery is impossible.
- **What first-use checks are worth running**, since the general case is undecidable:
  - **Classic token (`ghp_` prefix) → refuse.** All-repositories *by construction*, so the prefix convicts it offline, in zero API calls. This is the likeliest real over-scope in practice — an old token, pasted — so the free check covers the common case.
  - **`github-authentication-token-expiration` response header → warn before the 401**, not after. Free on every response, and it means expiry never has to be guessed from the template URL's `expires_in` — the token reports its own.
  - **A dangling-blob `POST git/blobs` → proves the token can actually write here.** One call; the blob is referenced by no tree and is garbage-collected. It deliberately does not separate "wrong repo" from "not scoped" from "missing `contents: write`" — GitHub 404s all three on purpose, so as not to leak whether a private repo exists. Report all three in one message rather than inventing a distinction the API refuses to make.
- This works because `api.github.com` sends CORS headers — a static page can call the REST API directly. GitHub's **device flow is not browser-usable** (no CORS on the token endpoint), which is why PAT is the zero-infrastructure choice. An optional one-file Cloudflare Worker OAuth (for teams) and client-side PKCE (if/when GitHub ships it) are later add-ons, not MVP.

### Content operations: Git Data API for writes, GraphQL for listing, Contents API for a single file

- **Listing** uses the **GraphQL API** in two phases, and never reads posts one by one (`prototype/post-listing/`, July 2026, measured against a 102-post site):
  - *Phase 1 — the only content call in steady state.* One query returns `entries { name oid }` for the resolved posts and drafts directories via aliases. Cost **1**. **It is no longer the app's only call, and no longer GraphQL**: resolving *where Jekyll reads from* (#17/#18, below) costs a `GET /pages` + `GET /repos` pair, then a `_config.yml` read and the REST Trees walk **in parallel** — the tree is repo-wide, so `collections_dir` only re-filters it rather than forcing another trip. **2 round trips, always.** Phase 2 stays GraphQL. The trip that used to be free was buying a wrong answer.
  - *Phase 2 — only on cache misses.* Blobs addressed **directly by oid**, one alias each: `b0: object(oid: "…") { ... on Blob { text } }`. Cost **1**; verified to 102 aliases in one query (`nodeCount` 0 — aliased oid lookups don't count against the node limit), so a cold start is one query at any realistic post count. **#12 chunks this into parallel batches of 100**: its page candidates are not bounded by a directory the way posts are, and 102 is the largest query anyone has actually measured.
  - **Blob oids are content hashes, so an `oid → {title, date, draft}` cache in `localStorage` never goes stale** — no TTL, no ETag, no invalidation logic. An edited post is simply a new oid, i.e. a miss. **200 posts: 1 call / ~7 kB gzip in steady state; 2 calls at cold start.** The cache holds *only* listing metadata (already-public content — see the threat model); never the token, never draft bodies.
  - **Do not ask for `text` in phase 1.** Measured at 102 posts: `name+oid+text` is 62.5 kB gzip vs 3.5 kB for `name+oid` — **~17×**, re-downloaded every load to refill a cache that is almost always warm. Both cost 1, so the rate limit doesn't notice; the user's connection does.
  - **GraphQL costs nothing against the bundle** (a query is a JSON POST, no client library) and bills a **separate 5,000-points/hr** budget, not REST's 5,000 requests/hr. Fine-grained PATs authenticate to it; CORS verified (`access-control-allow-origin: *`, `Authorization` allowed).
  - **It fails in a REST-shaped trap: errors arrive as HTTP 200 with an `errors` array.** A `res.ok` check reads success from a failure — check `body.errors`.
  - `Tree.entries` has **no pagination** (not a Relay connection), which is why phase 1 must stay lean — it is the one call that cannot be bounded. A **missing directory is `object: null`, not an error** (a site with no `_drafts/` is normal). **`Blob.text` is `null` for binary**; `isBinary`/`isTruncated` ride the same response, so the list explains itself and falls back to a filename-derived title rather than breaking.
  - *Fallback if GraphQL is ever unavailable:* Trees API `?recursive=1` (1 call, paths + shas), with its own cliff — a `truncated` flag above ~100k entries / 7 MB.
- **Reading one file** (opening the editor) uses the Contents API. Its **1 MB inline ceiling** applies only here — above that it returns metadata with no content and the Blobs API or the raw media type is required. This is a read limit, distinct from the ~100 MB write limit. **It is no longer the listing constraint**, because listing never touches Contents.
- **Writes** use the Git Data API (create blob → create tree → create commit → update ref). The Contents API is one-file-per-commit and has no move operation, so it cannot express the operations this app needs:
  - Publish is a *move* (`_drafts/x.md` → `_posts/YYYY-MM-DD-x.md`). Via Contents that is create+delete — two commits, non-atomic, and a failed delete leaves a **duplicate post live on the site**. Via Git Data it is one tree, one commit.
  - Insert-image-and-save is two files. One commit means one build instead of two.
  - Cost: 6 API calls per save (`getRef`, `getCommit`, `createBlob`, `createTree`, `createCommit`, `updateRef`) instead of one. Two are avoidable by caching the head commit's tree sha from the initial load. Worth it for the atomicity.
- **Prototype-verified** (`prototype/git-data-move/`, July 2026), against a scratch repo with a real fine-grained PAT:
  - `contents: write` reaches every Git Data endpoint — no separate permission, no 403. The permission set above is correct as written.
  - The move is atomic, and GitHub proves it: the API reports the commit as a single `renamed` file with `previous_filename` set, not an add plus a delete. Rename detection only fires *within* one commit, so this is direct evidence that no intermediate two-copies state ever existed.
  - Image + post in one commit, one build. Unicode round-trips intact via `TextEncoder`.
- **Concurrency has two independent guards, and the server-side one is the real guarantee:**
  - *Client-side*: re-read HEAD before writing and compare against the sha read at open time; refuse if it moved. Surfaces as a plain-language conflict ("this post changed since you opened it") before any write happens.
  - *Server-side*: `PATCH git/refs` with **`force: false` rejects a non-fast-forward update with `422 Update is not a fast forward`.** Even a buggy or racy client cannot clobber HEAD with a stale-parented commit.
  - **Never pass `force: true`.** That single flag is the entire safety property — it is the Git Data equivalent of the blob-sha compare-and-swap, and it is free.
- Content is base64 on the wire in both directions. **Encode/decode via `TextEncoder`/`TextDecoder`, never bare `atob`/`btoa`** — those mangle non-ASCII, so a single emoji in a post corrupts the file, silently and only for some users.

### Jekyll-aware, zero config

- Conventions hardcoded: date-prefixed `YYYY-MM-DD-slug.md` filenames, `_posts/` and `_drafts/` as the directory *names*, a front-matter form (title, date, description, tags, categories, cover image). **Their location is resolved, not hardcoded** — see below.

#### Where Jekyll actually looks (#17, #18)

`_posts` is a directory name, not a path, and phase 1 assumed otherwise (`HEAD:_posts` in one hardcoded query). That fails **silently**: a missing directory is `object: null`, indistinguishable from an ordinary site with no drafts — so a `/docs`-served site got an empty post list with no explanation, and its publishes landed where Jekyll never reads. **One resolved root** (`src/layout/`) is what every path now hangs off: `{ branch, sourceRoot, postsDirs, draftsDirs, writeBase, basis, postsScan }`.

Ordering is forced: `collections_dir` lives *in* `_config.yml`, but `_config.yml` lives at the source root, which is the thing being resolved. So **Pages API → source root → `<root>/_config.yml` → `collections_dir`**.

**Measured against the live API and against BOTH Jekyll versions in play (July 2026), not reasoned.** GitHub Pages' branch builds run **Jekyll 3.10.0** ([github-pages gem 232](https://pages.github.com/versions/)) — *not* 4.x — and that is exactly the `build_type: legacy` case where `source.path` is authoritative. An Actions build pins its own. **3.10 and 4.4.1 agree on every rule relied on below**; the one place they diverge is called out and deliberately not replicated. Re-derive any row with `ruby test/oracle/jekyll-layout-oracle.rb`.

| Fixture | Read as a post? |
|---|---|
| `_posts/`, `content/_posts/` with `collections_dir: content` | ✅ — and root `_posts/` **ignored entirely** |
| `content/_drafts/` with `collections_dir: content` | ✅ — root `_drafts/` **ignored**. `collections_dir` moves drafts exactly as it moves posts |
| `blog/_posts/`, `deep/nested/very/_posts/` — **no config at all** | ✅ — Jekyll reads `_posts`/`_drafts` from **every** directory at any depth, and the subdirectory flows into the URL |
| `_underscore/_posts/`, `.hidden/_posts/` | ❌ — the walk prunes `_` and `.` segments |
| `_included/_posts/` with `include: ["_included"]` | ✅ — **`include:` re-opens an underscore directory** |
| `archive/_posts/` with `exclude: [archive]` | ❌ — a user `exclude:` entry prunes, on both versions |
| `blog/node_modules/_posts/` | ✅ — **`exclude` patterns are root-anchored**, so a bare `node_modules` never prunes a nested one |
| `node_modules/_posts/`, **no `exclude:` key** | ❌ on both — the built-in defaults apply |
| `node_modules/_posts/`, user **sets** `exclude: [unrelated]` | **3.10: ✅ read · 4.4.1: ❌ pruned** — 3.10 *replaces* the default list, 4.x *merges* it (`add_default_excludes`) |

- **`_config.yml`'s own `source:` key is inert on GitHub Pages**, which [documents it as overridden](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll) (`source: [your repo's top level directory]`, alongside `safe`, `lsi`, `incremental`, `highlighter`). The Pages API is the only authority on the root; the key is never read. `collections_dir` is **not** on that override list, and is honoured.
- **The branch moves too.** `source.branch` was discarded alongside `source.path`; `HEAD` silently meant *the default branch*. Measured: **`jekyll/jekyll` builds from `gh-pages`** while its default branch is not gh-pages. A publish to the default branch there never goes live.
- **`GET /pages` requires authentication** — a public repo with Pages 404s anonymously, so the documented "works without authentication for public resources" waiver is **false for anonymous requests**. It *does* hold for tokens: a fine-grained PAT with `Contents: read` and nothing else returned 200 on both `jekyll/jekyll` and a scratch repo. **No `Pages: read` scope is needed** — the token stays minimal.
- **A 404 from `GET /pages` has two causes GitHub refuses to distinguish**: Pages is off, or the repo is private and the token lacks `Pages: read`. `private` (already on the `GET /repos` response) separates them. Reporting the second as the first tells a paying user their live site is switched off.

**The resolution ladder** — row 4 is the only hard failure:

| Condition | Resolves to |
|---|---|
| `GET /pages` ok, `build_type: legacy` | `source.branch` + `source.path` (`basis: 'pages'`) |
| `GET /pages` ok, `build_type: workflow` | default branch + root, **stated** — a workflow decides the source, so `source.path` is not in play, and parsing `.github/workflows/*.yml` is unbounded and not our schema |
| `GET /pages` → `null` | default branch + root, **stated** (`no-pages` / `pages-unreadable` per `private`) |
| No `_config.yml` **and** no `_posts/` at the root | **`LayoutError` — say so, refuse to list** |

The evidence test accepts `_config.yml` **or** `_posts/`: Jekyll builds fine with **no `_config.yml`** (Pages supplies defaults), so gating on the config alone would reject valid sites. Rows 2–3 degrade to exactly phase 1's behaviour (default branch, root) — the difference is that the app now *says* it assumed.

**Not cached.** The layout is resolved fresh per load. The `oid → title` cache is safe because oids are content hashes, so staleness is structurally impossible; a layout cache has no such key, and would be the first cache here needing *management* — holding the one value whose staleness reproduces the bug. Two requests against a 5,000/hr budget is the cheaper side of that trade.

**The walk (#18).** `<base>/_posts` is a single-directory query against what Jekyll treats as a **recursive scan** — a stock site with `blog/_posts/` is silently half-listed — so posts and drafts are collected from `<base>/**/_posts` via **REST Trees `?recursive=1`**: one call, the whole path list, filtered client-side. A GraphQL nesting depth was rejected as a limit *we* invented, i.e. #17's silent omission in a new hat. `postsDirs`/`draftsDirs` are the **read sets** and may be empty; **`writeBase`** is the separate always-usable write target, because a read set cannot answer "where does a *new* post go" (and a site whose only posts live in `blog/_posts` should get its next one there, not in a directory the app invented).

**The fence** is Jekyll's own: prune `_*`/`.*` segments (honouring `include:`), plus the **user's literal `exclude:` entries**. Jekyll's **built-in default excludes are deliberately not replicated** — the table above shows why: whether they apply depends on the Jekyll version *and* on whether the user wrote an `exclude:` key, and we can only see the version for `build_type: legacy`. They name only `node_modules`, `vendor/{bundle,cache,gems,ruby}`, `Gemfile`, `gemfiles`, `.sass-cache`, `.jekyll-cache` — the dot-prefixed ones are pruned structurally anyway, and none of the rest ever holds a `_posts`. Every rule that *is* honoured behaves identically on 3.10 and 4.4.1, so the fence is version-invariant **by construction**. Two residuals, documented not hidden: **glob patterns in `exclude:` are ignored** (matching them means reimplementing `File.fnmatch`), and a repo committing `node_modules` with a `_posts` inside gets phantom posts — on 3.10 with an `exclude:` key, Jekyll would publish them anyway.

Note the fence **bounds interpretation, not the fetch**: the Trees call is repo-wide regardless. That matters far more for page discovery (#12), where each candidate costs a front-matter read, than for posts, which are identified by path shape alone. `Resolved.sourceFiles` therefore carries everything walked that is *not* in a magic directory — pages and static files — so #12 filters it with **no further requests**.

**`truncated` is a degrade, not a shrug.** Above ~100k entries / 7 MB GitHub returns a **partial tree** and says only that it did, not what it cut. Deriving from it ships omission with no symptom, so `postsScan` becomes `'root-only'`: fall back to reading `<base>/_posts` and `<base>/_drafts` directly (exactly the pre-#18 behaviour), say so, and hand #12 nothing. The realistic way to reach it is a site in `/docs` inside a large monorepo — the tree call is repo-wide even when we want one folder.

#### What is a page? (#12)

Jekyll's answer, measured on **both 3.10.0 and 4.4.1** (`test/oracle/jekyll-layout-oracle.rb`, same fixtures as the walk above — posts and pages are two filters over one walk):

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

**Front matter is the only rule, and extension is irrelevant.** Applied honestly that means reading *every* file in the repo to find out — #5's "17× the bytes" mistake with no directory to bound it. So the app uses an **extension heuristic**: candidates are the site's own `markdown_ext` (read from `_config.yml`, not hardcoded — a site that renames it stops rendering `.md`) plus `.html`/`.htm`, and front matter decides among those. **The blind spot is stated, not buried**: a front-matter'd `LICENSE` is a page the CMS cannot see, and `MSG.pagesBlindSpot` says so on the list. #5 rejected slug-only titles because *"the list would lie"* — an omission the user is never told about is the same lie.

The heuristic also does an unplanned favour: `feed.xml`, `robots.txt`, and `sitemap.xml` are all genuinely pages to Jekyll, and all three drop out **by extension**, leaving essentially `index.*` and `404.html` as the "machinery" in scope.

**No content-vs-machinery distinction.** Jekyll has no such concept to read, so any taxonomy would be one the app invented — the thing "Jekyll-aware, zero config" forbids. The real hazard isn't that `index.md` is listed (owners legitimately edit their homepage) but that its body is Liquid and **`marked` renders `{% include %}` as literal text**, so the preview lies about a file the writer is about to trust. `{%`/`{{` in the body is a *measurable fact*, so the editor warns and caveats the preview instead. The textarea itself is safe: the body round-trips byte-for-byte.

**No page creation.** `pickWriteBase` can place a *post* because `_posts` is canonical — Jekyll defines it. Pages have no equivalent: `about.md`, `_pages/about.md`, and `pages/about.md` are equally valid and **nothing in `_config.yml` declares which this site uses**. Every existing page has already answered the question by existing; only creation has to guess, and on a themed site it guesses wrong. Deferred, and the honest version infers the convention from where the site's current pages live.

**The cache learns the negative.** `CacheEntry` gains `fm?: boolean`, because `title: ''` cannot distinguish "no front matter" (not a page) from "front matter without a title" (a page, humanize the filename). "README.md is not a page" is correct forever — oids are content hashes — so it is cached and never re-read. A missing flag means "never asked", so pre-#12 entries re-read once and self-heal: no key bump, no migration, nothing thrown away.

**Chunked blobs.** #5 verified one aliased query to 102 blobs when the only callers were two directories. Page candidates are every markdown file under the source root, which a docs-heavy site counts in thousands, so `fetchBlobs` splits into **parallel batches of 100** — the size that has evidence behind it, rather than probing for a cliff we cannot see. Cold start costs round trips, not sequence; steady state is still zero.

**Truncated ⇒ no pages at all.** Posts degrade to `<base>/_posts` because that directory is canonical. "Root-level pages only" is canonical to nothing — it is a **depth cap of 1**, the invented limit this ticket already rejected once. So the Pages section is absent and `MSG.treeTruncated` says pages cannot be listed, rather than letting a whole section vanish quietly.
- Extra front-matter fields are **inferred by sampling the repo's existing posts** — no schema file, ever. A site whose posts all carry `image.path` gets that field in the form. *(Built in #13, with two refinements the promise did not anticipate: the corpus is the 20 most recent posts rather than all of them, because conventions drift; and pages get no inference at all, because they are not a corpus. See "What fields does the form show?" above.)*
- **The form's field order is `title → date → description → tags → categories → image`.** It is not cosmetic: it is the rule for where a new key gets inserted. Since #13 these six are a floor for *posts only* — a page shows its own keys and nothing else — and inferred extras follow them.


#### What fields does the form show? (#13)

The form is **the fixed six (posts only) ∪ the file's own keys ∪ the inferred keys** — a pure function of the file plus the corpus, with no dependence on how the user arrived at the file. `buildFields` is the whole rule.

**A page's form is its own front matter, reflected back.** Pages are not a corpus: `index.md` carries `layout: home`, `404.md` carries `permalink: /404.html`, and a typical site has three or four, so no threshold means anything at N=3 and sampling yields the union of unlike things. Nor do pages *ask* the question inference answers — that question is *"this is a brand-new post with no front matter, what fields should it have?"*, and #12 already deferred page creation. Every page that exists has answered for itself, in the file, for free. So a page gets no six and no inference. This also fixes a live defect #12 shipped: the form offered `about.md` a Date and a Categories field, which nothing on the site reads and which #6's insertion rule would happily write into the file.

Because the six are posts-only and inference is posts-only, the rule collapses on a page to *the form mirrors the file* — one rule, no page branch.

**The corpus is the 20 most recent posts, not every post.** Conventions drift. A blog that started in 2015 with bare `title`/`date` and adopted `image.path` last year has ~10% of its posts carrying it, so an all-posts majority buries the very field the design promises to surface. The window tracks what the author is doing *now*, which is what their next post should look like. Post dates are already parsed from filenames, so the window costs nothing to compute. **N=20 has no evidence behind it** — no measurement can tell us the right window — so it is one defensible number, stated here, rather than a weighting curve nobody can inspect.

**The threshold is a strict majority of that window**: *more of your recent posts have this than don't*, which the site's owner can check by hand. It is self-dampening at small N precisely because the form unions in the file's own keys — at N=1 every "promoted" key is already an own key, and at N=2 a key in one post is 50% and not promoted. Inference starts mattering exactly when there is enough corpus for "majority" to mean something.

**Fields are leaf scalars, addressed by dotted path.** `leaves()` walks a parsed mapping: a scalar is a leaf (`title`), a map recurses (`image.path`, `header.teaser`), a sequence of scalars is one leaf with a CSV widget (`tags`), and there is **no depth cap** — #12 already rejected invented limits. This dissolves the editor's hand-written `image` scalar-vs-nested special case: the file's own shape names the path, and `patch` writes back to the path it was given. `create` now expands dotted paths too, or a new draft would grow a key literally named `image.path`.

**Under a six key, the file wins outright**; the corpus only speaks where the file is silent. Without that rule, a post with a scalar `image:` on an `image.path` site renders *two* cover-image fields, one of which silently writes the other's shape. `image.path` is the six's default only because it is what the hardcoded form did before inference existed — either the file or the corpus overrides it.

**`list` wins any shape disagreement across the window.** A one-item list reads back the same as the scalar for Jekyll's `tags`-style keys; a scalar written where the site means a list silently degrades a taxonomy to one string. The asymmetry is the whole tie-break.

**Extras are labelled with their raw key path, verbatim.** The label's job is to connect the field to what the theme's docs told the owner to set: `redirect_from` is the exact string jekyll-redirect-from's README uses, and "Redirect From" is a name that exists nowhere and cannot be searched for. The six keep their hand-written labels.

**The cache carries the corpus.** `CacheEntry` gains `keys?: KeyShapes` — leaf path → shape — on exactly the terms `fm` was added: a pure function of the same content hash, so `undefined` means "never asked" and a pre-#13 entry in the window re-reads once and self-heals. One cache, not two, because two oid-keyed caches can disagree about which blobs they have seen. A warm cache infers with **zero requests**. The shape is stored with the path because writing `tags: "a, b"` where the site means a list is a silent change to what Jekyll reads. A key whose shape gets no field is never stored — promoting it would let it pass the threshold and then render nothing.

**Two admitted warts.**
- **Form order and file order disagree for extras.** #6 gives a key outside `FORM_ORDER` `rank === -1`, so it inserts *after the last key in the file*: an inferred `author` shows seventh in the form and lands at the bottom of the front matter. Harmless — Jekyll does not care about key order — and the fix is threading a per-site order through `src/frontmatter/`'s public API, which is a large change to the one module the design says to keep small.
- **A sequence of maps (`gallery: [{url: …}]`) gets no field.** No text widget round-trips it. The key survives untouched because `patch` only names keys in the edit set, but the owner has to edit it on GitHub — the same blind spot `MSG.pagesBlindSpot` already admits to, rather than a rendered `[object Object]` they would then save back.

**What did not need deciding.** *"Does an inferred field left blank get written as an empty key?"* is already answered by the code: `diffEdits` emits an edit only when the value changed, so an untouched field produces nothing and #6's insertion rule never fires; `create` skips empties on the new-post path. Both paths agree, and neither needed a rule.

### Front-matter round-trip safety

**A hard invariant:** unknown front-matter keys, comments, key order, and formatting are preserved verbatim. Opening and saving a file the owner hand-edits elsewhere must never launder it.

**Resolved by prototype** (`prototype/frontmatter-roundtrip/`, July 2026). The invariant holds, at roughly double the expected cost. Findings:

- **Use `yaml`'s CST API, not its AST API.** The obvious route — `parseDocument` → `doc.setIn()` → `doc.toString()` — is parse-and-redump by another name: it keeps comments and key order but re-renders every line, normalising `layout:      post` → `layout: post`, reflowing folded scalars onto one line, and rewriting flow arrays. `keepSourceTokens` does not prevent this; the flag preserves the tokens but `toString()` ignores them. The working route is `Parser` → `Composer({keepSourceTokens})` → `CST.setScalarValue(node.srcToken, v)` → `CST.stringify(token)`, which re-emits every byte the parser saw. Verified byte-identical across comments, nested maps, block/folded/literal scalars, flow arrays, anchors/aliases, odd spacing, and unicode.
- **Budget: ~30 kB gzipped, not ~15 kB, and it does not tree-shake** (CST-only saves 0.8 kB over the full library — `Parser` + `Composer` pull in nearly everything). Still fits: ~30 + ~4 Preact + ~13 markdown ≈ 47 kB, leaving ~50 kB for the app. If it tightens, code-split the patcher behind the editor route — the post list doesn't need it.
- **Adding a new key has no CST path.** `CST.setScalarValue` only edits existing scalars, so adding a key needs a text insertion. **This is phase 1, not inference**: a user typing a `description` into a post that lacks one is inserting a key, in the core loop.
- **Insertion rule (resolved by prototype): form order, ranked by file position.** Insert after the last present key that *precedes* the new one in the form's field order; fall back to the end of the block when no predecessor is present. Existing keys never move. **This dissolves the comment-adoption problem rather than special-casing it** — a new `description` lands after `date` and *above* a `# Taxonomy below` comment, which goes on labelling the taxonomy. **Rank by file position, never form position:** a file may order `categories` before `tags` while the form does the reverse, and trusting form position inserts into the wrong place.
- **Structural escaping is not enough — the *type* layer leaks on both write paths, and the CST path is the worse one.** Verified against real Ruby Psych (`prototype/frontmatter-roundtrip/psych-oracle.rb`, called as Jekyll calls it), 14 values per path, counting how many Jekyll silently re-types:

  | write path | wrong | Jekyll reads |
  |---|---|---|
  | `stringify` @1.2 (library default) | **10** | `yes`→`true`, `NO`→`false`, `12:30`→`45000`, `1_000`→`1000`, `2024-03-01`→`Date` |
  | `stringify` @1.1 | **0** | — |
  | **`CST.setScalarValue` (naive)** | **11** | the above **plus `0777`→`511`** |
  | CST + forced quote when unsafe | **0** | — |

  **`CST.setScalarValue` quotes only for structural breakage** (`a: b`, `#hash`) — it protects syntax, not types — and **inherits the source's quote style**, so it is safe only when the owner happened to quote the original. Editing `title: The Old Title` to `yes` emits `title: yes`, and the site gets boolean `true`. There is no `version` option on the CST API; it is a byte-level operation.
- **The rule, both paths:** new keys → `stringify(value, { version: '1.1' })`. Existing keys → `CST.setScalarValue(token, value, { type: 'QUOTE_DOUBLE' })` **when** `stringify(value, {version:'1.1'}).trim() !== value`, i.e. force quotes exactly when the 1.1 serializer says the plain form would be re-typed. Reads parse at `1.1` too. Values that need no quoting keep the owner's formatting.
- **The trap is wider than booleans:** sexagesimals (`12:30`→`45000`), octal (`0777`→`511`), underscored digits (`1_000`→`1000`) and dates (`2024-03-01`→a `Date`) all re-type. Booleans are only the memorable case.
- **The JS `yaml` library is not an oracle for Jekyll.** Both call themselves YAML 1.1 and disagree — the JS lib treats `y`/`n` as booleans, Psych does not. Asking the JS reader whether the JS writer was safe only proves the library agrees with itself. **Psych answers, or nothing does** — hence the oracle script.
- **Nested keys are a block, not a line**, and the design's own example is one: `image.path` where `image` is absent, with cover image sitting in the *phase-1* form. `stringify({image: {...}})` emits it, but **the indent must be detected from the file** — stringify's default of 2 bolts a foreign-looking block into a 4-indented file.
- **Residual, unavoidable:** a key last in form order with no successor present still lands at the end, where a trailing comment can adopt it. **YAML comments have no owner** — whether `# Taxonomy below` heads `tags` or trails `date` is undecidable. The rule minimises damage; it is not correct, because correct is not available.

### Publish = the finish line (the differentiator)

- Draft → Publish moves `_drafts/x.md` → `_posts/YYYY-MM-DD-x.md` in one commit to the default branch — one atomic Git Data commit, per the content-operations section above.
- The app then polls the **Deployments API** and renders the journey: *Publishing… → Build passed → **Live at https://site/your-post/*** — a real link, verified reachable before it's shown.
- Build failures are translated to human terms ("your post's front matter has a stray quote on line 3"), with a one-click revert that commits the previous file content back.

**Prototype-verified** (`prototype/finish-line/`, July 2026), against a public scratch site on a custom domain with a branch-based build. **The whole loop takes ~40–60s**: the deployment appears ~3s after the commit, the build completes in 37–58s, and the post is live *and* in the sitemap by the time the build reports success.

- **Track the build via Deployments, not `/actions/runs`.** `GET /deployments?sha={sha}&environment=github-pages`, then `/deployments/{id}/statuses` (`waiting → queued → in_progress → success`). **`environment=github-pages` is stable across both build types**, so there is one code path instead of two. The Actions route cannot manage that: a branch-based deploy's run is *synthetic* (`event: dynamic`, `path: dynamic/pages/pages-build-deployment` — not a real file in `.github/workflows/`), while an Actions-source sha may carry several runs and "which one is the Pages build?" has no reliable answer. **Not yet verified on an Actions-source repo** — the reasoning is sound, the measurement is missing.
- **"No Pages configured" is one call, not a timeout.** `GET /repos/{owner}/{repo}/pages` → 404 means Pages is off; that is categorically distinct from "the deployment hasn't registered yet". Check it before polling anything.
- **`environment_url` on the deployment status is GitHub stating the site root** — no derivation, no `_config.yml` parsing.

**Finding the live URL: sitemap first, derivation second.** Deriving the URL from `_config.yml` means reimplementing Jekyll's permalink resolution — pretty/date/custom styles, categories in the path, `baseurl`, CNAME custom domains — and every edge case missed is a broken promise in the one feature that justifies the project. Instead, once the build passes, fetch the site's `sitemap.xml` (or `feed.xml`) and locate the new entry: **Jekyll computed that URL itself, so it is authoritative.** `_config.yml` derivation survives only as a fallback when no sitemap plugin is present, and for the pre-publish preview, where a wrong guess is cheap. Verified: `jekyll-sitemap` is whitelisted on the branch-based builder, the post is listed by the time the build succeeds, and the declared URL resolves. With no plugin, `sitemap.xml` returns 404 — cleanly detectable.

**But the sitemap is authoritative about Jekyll, not about reality — it faithfully reproduces the user's misconfiguration.** `jekyll-sitemap` builds each `<loc>` from `site.url` + `site.baseurl` + `page.url`, so a project page with `baseurl` unset emits URLs missing the `/<repo>` prefix and **every one of them 404s**. That is the most common Jekyll project-page mistake, it is invisible from inside the site (links work when clicked from within it), and nothing warns. Trusting the sitemap blindly means confidently reporting "live at ‹url›" pointing at a 404 — worse than reporting nothing. **Cross-check each `<loc>` against the deployment's `environment_url`:** if it doesn't start with it, the sitemap is misconfigured, and *that* is the error to explain ("your `_config.yml` has `baseurl` unset") rather than a bare liveness failure. First concrete entry in the error-translation vocabulary.

**A green build does not mean the post is live** — prototype-verified, and **the sitemap is the detector**. On a green build, both traps below return **404** *and* are **absent from `sitemap.xml`**. So a passed build plus a URL missing from the sitemap means Jekyll deliberately skipped the post: that is the difference between "still building" and "built, and silently dropped". **No API call is needed to explain which:** the app wrote the front matter, so it already knows. The sitemap says *that* it was skipped; local state says *why*. The sitemap thus does double duty — URL discovery and trap detection.
- **`future: false`** (Jekyll's default) silently skips posts dated ahead of the build clock. Publishing at 11pm in a UTC+ zone dates the post tomorrow — build passes, post never appears. Timezones make this routine, not exotic: **the prototype written to test this trap fell into it**, by building a date from `toISOString()` (UTC) while the local clock still read yesterday.
- **`published: false`** in front matter does the same thing, deliberately.
- **No Pages build configured at all.** Not a timeout heuristic: `GET /repos/{owner}/{repo}/pages` → **404** answers it in one call, before any polling.

**The liveness check's origin trap does not exist, and the cache trap is narrower than it looks.** Pages sends `access-control-allow-origin: *` on content, so a normal `fetch()` reads the status cross-origin — `no-cors` and its unreadable opaque response are never needed. It is moot anyway: `owner.github.io/repo/` **301-redirects to the custom domain**, so `/admin/` (which lives *in* the site) is always same-origin with the posts. Genuine cross-origin requires the sitemap to name a different host — the misconfiguration above, now detected. On caching: **404s carry no `cache-control` and do not go stale**, so a pre-publish probe cannot poison the post-build check and a cache-buster is not required. **200s do carry `max-age=600`** — irrelevant to liveness, but *editing* an existing post can serve stale content for ~10 minutes, which the "verified live link" UX must not promise away.

### Editor

Markdown `<textarea>` + live side preview (micromark or marked) + a minimal toolbar (bold, link, image, heading). No block editor, no WYSIWYG framework. Image insert = upload to `assets/img/...` + inserted markdown reference.

### Setup wizard (first run)

Checks the repo has GitHub Pages enabled and a build workflow. Where the API can't act with a PAT's permissions, it shows click-here GitHub UI instructions with live verification checks ("✓ Pages is enabled" turns green when done).

Worth verifying before writing that flow: `POST /repos/{owner}/{repo}/pages` with Pages:write may let the wizard enable Pages directly, deleting a manual step rather than narrating it.

### Stack

TypeScript + Preact (~4 kB runtime). No React. Bundle budget ~100 kB gzipped total, enforced in CI when code exists.

## MVP phases

1. **Core loop:** PAT auth → list posts → edit/create → commit → deploy status → verified live link.
2. **Content comfort:** drafts flow, image upload + insertion, ~~front-matter inference~~ (landed in #13), conflict handling, one-click revert.
3. **Onboarding:** setup wizard, PAT-expiry reminders, optional one-file Cloudflare Worker OAuth for teams, data-file editing.

*Page **editing** landed early (#12): the list view is the front door and had to know how many kinds of thing it holds before the form-fields work could proceed. Page **creation** is still deferred — see below.*

## Known risks and accepted limits

- **PAT lifecycle:** fine-grained tokens expire (≤ 1 year). The `github-authentication-token-expiration` response header carries the expiry on every call, so warn ahead of time and treat a 401 as the fallback, not the trigger. Tokens are per-user credentials — never shared; each editor needs push access and their own PAT.
- **An over-scoped token is undetectable, and the guarantee rests entirely on the user's dropdown choice.** Prototype-verified — see the auth section. If a user grants "All repositories", the app cannot tell and will never warn. The install-time callout is the only mitigation that exists, which is why it has to be loud.
- **Both token risks are latent rather than static — they scale with the account, and they arrive silently.** Severity tracks how many repos the owner has, so the *target persona* — a blogger whose only repo is their site — is barely exposed at install: an "All repositories" token over one repo has the same blast radius as a correctly-scoped one, and the shared-origin hole below needs a second Pages site to exploit. **That safety is a snapshot, not a property.** A fine-grained PAT scoped to "All repositories" also covers repos that *do not exist yet*: the day the owner creates a second repo, a token stored a year ago silently gains write access to it — no prompt, no re-consent, and per the auth section, no way to detect it. Publishing a second Pages site opens the origin hole retroactively for a token already in storage. The exposure grows while nobody is looking, which is why the dropdown callout matters most for the user least able to judge it. Seasoned multi-repo users carry the risk from day one and are likelier to spot it; the intended user carries it later and will not.
- **API size limits:** base64 payloads; ~100 MB/file write ceiling — fine for blog media. The **1 MB read ceiling** on the Contents API applies only to opening a single file in the editor — listing goes via GraphQL and never touches it. See content operations.
- **The post list has no upper bound, and the walk widened it.** `Tree.entries` is not a Relay connection and the Trees API has no pagination either, so the listing is whatever the repo holds. Measured at ~104 B/post via GraphQL, a 200-post site was ~7 kB gzip. Since #18 the walk fetches the **whole repo tree**: measured **1.1 kB gzip / 19 entries** on a scratch blog and **45.7 kB / 949 entries** on `jekyll/jekyll` (a code repo, not a blog) — the same order, not a different one, and nowhere near the `truncated` cliff (~100k entries / 7 MB), which is now detected and degraded rather than ignored. Still a response that grows forever with no mechanism to bound it. Revisit if a site ever gets absurd. **#12 extends this to requests, not just bytes**: every markdown file under the source root is a page candidate needing a front-matter read, so a cold start now costs `ceil(candidates / 100)` parallel blob queries where it once cost one. Bounded per-query, unbounded in total — the oid cache makes it a once-per-blob cost, never a steady-state one.
- **GraphQL is a second API surface with REST-shaped failure.** Its errors arrive as **HTTP 200 with an `errors` array**, so any client that checks `res.ok` reads success from a failure. It also bills a separate 5,000-points/hr budget. One shared request helper must handle both surfaces, or this bug gets written twice.
- **The JS `yaml` library and Jekyll disagree about what a file *means*, by default, on every write path.** The library is 1.2, Ruby's Psych is 1.1. Verified against real Psych: the library default re-types 10 of 14 sample values and the CST path 11 — booleans, sexagesimals (`12:30`→`45000`), octal, underscored digits, and dates. Both are fixable to zero (see round-trip safety), but the fix is **per-call-site discipline, not configuration**: there is no global switch, and the CST API has no `version` option at all. **Wrap the library once and never call it directly**, or a single missed call site silently changes what a post says. The JS parser cannot detect this — it agrees with the JS writer; only `psych-oracle.rb` can.
- **Token storage:** PAT in `localStorage` on a public site's `/admin/` path. The app must be fully self-contained (no third-party scripts at runtime), and the threat model documented for users. The sharper edge than third-party scripts: **`username.github.io` is a single origin shared by every project page that user publishes.** Any other repo of theirs served from that subdomain can read the admin page's `localStorage` and with it a token that has write access to the site repo. Users on the default subdomain must be told this plainly.
- **Self-update makes this project a supply chain, and nothing available fixes that.** Every install runs the bundle this repo serves, and each install carries a `contents: write` PAT — so a compromise here reaches every user who clicks update, with write access to their site. No integrity check helps (see install and update): a hash shares the bundle's source, and CI-held signing keys fall with the repo. The real mitigations are ordinary ones — protect the repo and the release path, and keep updates explicit and user-initiated so a bad version reaches only those who act, and only after it is published long enough to be noticed. Worth revisiting if signing ever moves offline.
- **No review workflow in MVP:** commits go straight to the default branch. An editorial/PR workflow is explicitly out of scope until later phases.

## Verification plan (for the eventual implementation)

- Drive the full loop against a scratch `jekyll new` repo with a GitHub Pages workflow — **never a production site**: create draft → edit → publish → watch status → confirm the post is live at the reported URL.
- **Round-trip test:** hand-write a post with exotic front matter (nested keys, comments, odd spacing); open and save it in the CMS; `git diff` must be clean except the intended edits.
- **Unicode test:** a post with emoji and non-Latin text must survive a save byte-identical.
- **Green-build-but-not-live test:** publish a deliberately future-dated post and confirm the UI explains why it isn't live, rather than spinning on a passed build.
- **Theme-agnostic check:** repeat the loop on Minima and on a Hydejack site (read-only browse + one throwaway draft).
- **Budget check:** built bundle ≤ ~100 kB gzipped.

## Decision log

| Decision | Choice | Why |
|---|---|---|
| Build vs fork vs plugin | Standalone | Decap fork = rewrite with fork burden; plugin = undocumented backend API + still ships Decap's weight |
| Auth (MVP) | PAT-only, guided | Zero infrastructure; device flow is CORS-blocked in browsers; OAuth worker deferred to phase 3 |
| Token scope check | None — it is impossible | Prototype-verified: over-scope is undetectable client-side. `permissions` reports the user's role, not the token's grant; a fine-grained PAT cannot enumerate private repos, so no canary is discoverable. The probe works, discovery doesn't. Struck the design's promise to verify rather than reword it |
| Token first-use checks | Prefix, expiry header, blob probe | The decidable subset: `ghp_` is all-repos by construction (free, offline); `github-authentication-token-expiration` warns before the 401 (free); a dangling-blob write probe proves the token can actually publish. Wrong-repo / unscoped / missing-permission all 404 alike by design — one message, not three |
| Write API | Git Data API, not Contents | Contents is one-file-per-commit with no move: publish would be a non-atomic create+delete that can leave a duplicate post live. Git Data buys atomic multi-file commits for 6 calls per save (~4 with caching). Prototype-verified, including that a fine-grained PAT's `contents: write` reaches the endpoints |
| Where Jekyll reads from | One resolved root (`src/layout/`), from the Pages API + `_config.yml` | `_posts` is a name, not a path: `collections_dir` and Pages' `/docs` folder both relocate it, and `source.branch` need not be the default branch (`jekyll/jekyll` builds `gh-pages`). Phase 1's `HEAD:_posts` failed **silently** — a missing dir is `object: null`, so a `/docs` site got an empty list and published where Jekyll never reads. The data was on a response already fetched. Measured against the live API and both Jekyll 3.10 (what Pages runs) and 4.4.1, incl. that `collections_dir` moves `_drafts` too, that Pages **overrides** `source:`, and that `Contents: read` alone can read `/pages`. Resolved fresh per load — a stale root *is* the bug |
| Finding posts | Whole-repo REST Trees `?recursive=1`, filtered by Jekyll's fence | Jekyll reads `_posts`/`_drafts` from **every** directory at any depth with no config, so `<base>/_posts` half-lists a stock site — and a GraphQL nesting depth would be a limit we invented, i.e. the same silent omission. The fence honours `_`/`.` (with `include:`) and the user's literal `exclude:`, but **not** Jekyll's built-in defaults: 3.10 replaces them when `exclude:` is set, 4.x merges them, and the version is invisible for Actions builds — while the defaults never name a directory holding posts. Every honoured rule is identical on both versions. `truncated` degrades to the canonical directory and says so |
| Finding pages | Front matter, over an extension-heuristic candidate set from the same walk | Measured on both 3.10 and 4.4.1: front matter is Jekyll's **only** rule and extension is irrelevant — a front-matter'd `LICENSE` is a page, `README.md` is a static file — so identity lives *inside* the file and no tree listing can decide it. Honouring that literally means reading every file in the repo (#5's mistake, unbounded). Candidates are the site's own `markdown_ext` + `.html`/`.htm`; the missed extension-less page is **stated in the UI**, because an unannounced omission is the same lie #5 rejected. Rides #18's walk and #5's oid cache: no extra request, and the front-matter read *is* the title read the list needed anyway. `feed.xml`/`robots.txt` are real pages that drop out by extension, which is most of the "machinery" problem gone by accident |
| Content vs machinery | No distinction; warn on Liquid instead | Jekyll has no such concept to read, so any taxonomy is one we invented — the thing "zero config" forbids, and owners legitimately edit `index.md`. The real hazard is that `marked` renders `{% include %}` as literal text, so the **preview** lies; `{%`/`{{` is a measurable fact about the file, not a category, so it can be warned about honestly. The body round-trips byte-for-byte regardless |
| Page creation | Deferred — edit only | `pickWriteBase` can place a post because `_posts` is **canonical**; pages have no equivalent, and `_config.yml` never declares whether this site uses `about.md`, `_pages/`, or `pages/`. Existing pages answered it by existing; only creation must guess, and it guesses wrong on themed sites |
| Non-page caching | `fm?: boolean` on the existing entry | `title: ''` conflates "no front matter" with "front matter, no title" — one is a static file, the other a page. The negative is the valuable half and is correct forever (oids are content hashes), so it is cached. Optional, so pre-#12 entries re-read once and self-heal: no key bump, no refill |
| Blob batching | Parallel chunks of 100 | #5 verified 102 aliases when the callers were two directories; #12 unbounds it to every markdown file under the root. Where an aliased query actually breaks is unmeasured, so the batch is the number with evidence behind it rather than a probe for the cliff |
| Live-URL discovery | `sitemap.xml`, cross-checked against `environment_url` | Jekyll already computed the URL; deriving it means reimplementing permalink styles, `baseurl`, categories, and CNAME handling, and owning every edge case. Prototype-verified — but the sitemap reproduces the user's `baseurl` mistake and emits URLs that 404, so the deployment's `environment_url` is the ground truth it gets checked against |
| Build tracking | Deployments API, not `/actions/runs` | `environment=github-pages` is stable across both build types, so one code path. A branch-based run is synthetic (`dynamic/pages/pages-build-deployment`, not a real workflow file); an Actions-source sha may carry several runs with no reliable way to pick the deploy. Statuses give `waiting→queued→in_progress→success`, and `environment_url` names the site root. Verified branch-based; Actions-source reasoned, not measured |
| Distribution | In-repo `/admin/` | Decap-familiar, host-agnostic, owner pins the version; no central service to run or trust |
| Bundle home | Vendored, not CDN | The trade was false: the design already pins the version, which is the CDN's *only* advantage. Pinned CDN + SRI costs the same edit to update while adding an availability dependency and a trust surface; unpinned CDN is a third party mutating code on a page holding a write PAT. Vendoring dominates |
| Install | Hosted installer, used once | Writes the `owner/repo` config line correctly *by construction*; a hand-typed line is the hard-error case repo identity rules fatal. Not a runtime service — static, used once, never contacted again, and no new trust party |
| Update | Self-commit, explicit, unverified | The app already has `contents: write`; the bundle is fetched unauthenticated from the public project repo (`api.github.com` sends CORS `*`), so no CDN is needed. **No integrity check is possible**: a hash is circular (same source), and TOFU signing only helps with an offline key — this project signs in CI, where a repo compromise yields the key. Trusting this repo is the deal; the update is explicit and user-initiated, never silent |
| Update recovery | Installer doubles as repair | A bad bundle bricks the only tool a git-averse owner has. Reinstalling restores a known-good `/admin/`; keeping N-1 would need a git operation the owner cannot perform |
| Transport | Hard-refuse plain HTTP | A PAT on an MITM-able page makes every other defence theatre — the attacker is running *in the page*, so HTTPS API calls are irrelevant. Observed live: Pages defaults `https_enforced: false` on a custom domain until the cert provisions |
| Stack | TypeScript + Preact | ~4 kB runtime, JSX ergonomics, fits the size budget |
| Editor | textarea + preview | Minimalism over WYSIWYG; block editors are where CMS bundles go to bloat |
| Front matter | `yaml` CST API, ~30 kB gz | Only route that preserves formatting byte-for-byte; the AST API launders files. Prototype-verified — costs 2× the original estimate, still inside budget |
| Post listing | GraphQL, two phases, oid-keyed cache | Prototype-verified on a 102-post site. The ticket's premise was wrong: there is no per-post read, so no N and no 1 MB ceiling. Phase 1 (`entries { name oid }`, both dirs, cost 1) is the only call in steady state; phase 2 fetches *only* cache misses by oid (cost 1, verified to 102 aliases). **Blob oids are content hashes, so the cache never goes stale** — invalidation is deleted, not managed. Asking for `text` in phase 1 costs 17× the bytes to refill a warm cache. REST Trees `?recursive=1` is the fallback |
| Front-matter key insertion | Form order, ranked by file position | The form's fixed field order beats a sampled corpus, and works before inference exists (phase 2). Dissolves comment adoption rather than special-casing it: a new `description` lands above `# Taxonomy below`, which goes on labelling the taxonomy. File position, never form position — files order keys their own way. Residual: a key last in form order can still be adopted by a trailing comment; YAML comments have no owner, so no rule is *correct* |
| YAML typing | `1.1` on stringify/parse; forced quotes on the CST path | Jekyll parses with Ruby's Psych (YAML 1.1); the `yaml` library defaults to 1.2. Verified against real Psych: the library default re-types **10 of 14** sample values (`yes`→`true`, `12:30`→`45000`, `1_000`→`1000`, `2024-03-01`→`Date`), and **`CST.setScalarValue` — the primary edit path — re-types 11**, because it quotes only for structural breakage and inherits the source's quote style. Both fixes verified to 0. The JS lib is *not* an oracle for Jekyll (it calls `y`/`n` booleans; Psych doesn't) — only `psych-oracle.rb` can answer |
| Page form (#13) | The page's own front-matter keys, reflected back — no six, no inference | Pages are not a corpus: `index.md` has `layout: home`, `404.md` has `permalink:`, and N≈3 makes every threshold meaningless. Inference answers *"new post, no front matter — what fields?"*; a page that exists has already answered, in the file, for free, and #12 deferred page creation. Also retires a live defect: the form was offering `about.md` a Date and Categories field |
| Inference scope (#13) | Every post form — the six ∪ own keys ∪ inferred | Makes the form a pure function of file + corpus with no hidden dependence on the file's age. New-posts-only is unstable: `create` omits an empty inferred field, so reopening the same file would show a *different* form and the offered field would vanish for good |
| Inference corpus (#13) | The 20 most recent posts | Conventions drift — a blog that adopted `image.path` last year has ~10% of posts carrying it, so an all-posts majority buries the field the design promises to surface. Dates are already parsed from filenames, so the window is free. **N=20 has no evidence behind it**; it is one defensible number rather than a recency curve nobody can inspect |
| Inference threshold (#13) | Strict majority of the window | "More of your recent posts have this than don't" — checkable by hand. Any-post promotes every one-off (`mathjax`, `redirect_from`) onto every form forever; 100% dies to one outlier in a 20-post window. Self-dampening at small N, because own keys are unioned in anyway: at N=1 inference adds nothing it did not already have |
| Editable key shapes (#13) | Leaf scalars by dotted path; scalar sequences as CSV; sequences of maps get no field | Dissolves the editor's hardcoded `image` scalar-vs-nested branch — the file's own shape names the path and `patch` writes to the path it was given. No depth cap (#12 rejected invented limits). Residual, stated: `gallery: [{url: …}]` is uneditable in the CMS and must be edited on GitHub — no text widget round-trips it, and rendering `[object Object]` over a value the user then saves is worse |
| Six vs corpus collision (#13) | Under a six key the file wins outright; the corpus speaks only where the file is silent | Without it, a scalar-`image:` post on an `image.path` site renders two cover-image fields, one silently writing the other's shape. Caught by a test, not by review |
| Inferred field labels (#13) | Raw key path, verbatim; the six keep hand-written labels | The label must connect the field to what the theme's docs told the owner to set. `redirect_from` is the exact string the plugin's README uses; "Redirect From" exists nowhere and cannot be searched for |
| Corpus storage (#13) | `CacheEntry.keys?: KeyShapes`, same oid-keyed cache | The `fm` precedent exactly: a pure function of the same content hash, so `undefined` means "never asked" and a pre-#13 entry re-reads once and self-heals — no migration, no key bump. One cache, because two oid-keyed caches can disagree about which blobs they have seen. Warm cache infers with zero requests |
