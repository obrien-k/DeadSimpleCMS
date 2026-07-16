# DeadSimpleCMS — Design Document

*Status: design phase. No code exists yet.*

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

One HTML file at `/admin/index.html` in the user's site repo, loading a pinned, versioned JS bundle. The page is excluded from Jekyll layout processing (front-matter-free HTML passes through untouched). It works on any theme because it never touches the theme — it only reads and writes content files via the GitHub API.

### Auth: fine-grained PAT, guided

- Fine-grained GitHub personal access token, scoped to the one site repo. Permissions: Contents read/write, Actions read, Pages read, Metadata read.
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

- **The one step the URL cannot pre-fill is repository selection.** There is no `repositories` or `repository_ids` parameter; scoping the token to the single site repo stays a manual dropdown choice. That step is exactly the one that enforces the per-repo scoping above, so the UI must call it out explicitly ("choose **only** {repo} under Repository access") and then verify it — a token scoped wider than one repo should be detected on first use and warned about, not silently accepted.
- This works because `api.github.com` sends CORS headers — a static page can call the REST API directly. GitHub's **device flow is not browser-usable** (no CORS on the token endpoint), which is why PAT is the zero-infrastructure choice. An optional one-file Cloudflare Worker OAuth (for teams) and client-side PKCE (if/when GitHub ships it) are later add-ons, not MVP.

### Content operations: Git Data API for writes, Contents API for reads

- **Reads** use the Contents API to list `_posts/` and `_drafts/` and fetch file content. Note the ceiling: the Contents API returns inline content only up to **1 MB** — above that it returns metadata with no content, and the Blobs API or the raw media type is required. This is a read limit and is distinct from the ~100 MB write limit; cover images routinely cross it.
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

- Conventions hardcoded: date-prefixed `_posts/YYYY-MM-DD-slug.md` filenames, `_drafts/` for drafts, a front-matter form (title, date, description, tags, categories, cover image).
- Extra front-matter fields are **inferred by sampling the repo's existing posts** — no schema file, ever. A site whose posts all carry `image.path` gets that field in the form.

### Front-matter round-trip safety

**A hard invariant:** unknown front-matter keys, comments, key order, and formatting are preserved verbatim. Opening and saving a file the owner hand-edits elsewhere must never launder it.

**Resolved by prototype** (`prototype/frontmatter-roundtrip/`, July 2026). The invariant holds, at roughly double the expected cost. Findings:

- **Use `yaml`'s CST API, not its AST API.** The obvious route — `parseDocument` → `doc.setIn()` → `doc.toString()` — is parse-and-redump by another name: it keeps comments and key order but re-renders every line, normalising `layout:      post` → `layout: post`, reflowing folded scalars onto one line, and rewriting flow arrays. `keepSourceTokens` does not prevent this; the flag preserves the tokens but `toString()` ignores them. The working route is `Parser` → `Composer({keepSourceTokens})` → `CST.setScalarValue(node.srcToken, v)` → `CST.stringify(token)`, which re-emits every byte the parser saw. Verified byte-identical across comments, nested maps, block/folded/literal scalars, flow arrays, anchors/aliases, odd spacing, and unicode.
- **Budget: ~30 kB gzipped, not ~15 kB, and it does not tree-shake** (CST-only saves 0.8 kB over the full library — `Parser` + `Composer` pull in nearly everything). Still fits: ~30 + ~4 Preact + ~13 markdown ≈ 47 kB, leaving ~50 kB for the app. If it tightens, code-split the patcher behind the editor route — the post list doesn't need it.
- **Adding a new key has no CST path.** `CST.setScalarValue` only edits existing scalars, so front-matter inference (adding `description` where none exists) needs a text insertion before the closing `---`. Serialize the value with `yaml`'s `stringify()` rather than hand-building the line, or a title containing `: `, a leading `#`, or a quote will emit broken YAML. Open question: a naive append lands the new key under whatever comment block ends the front matter, so it reads as though that comment labels it — insertion point wants to be after the last *uncommented* key.

### Publish = the finish line (the differentiator)

- Draft → Publish moves `_drafts/x.md` → `_posts/YYYY-MM-DD-x.md` in one commit to the default branch — one atomic Git Data commit, per the content-operations section above.
- The app then polls `GET /repos/{owner}/{repo}/actions/runs?head_sha=…` plus the Pages API and renders the journey: *Publishing… → Build passed → **Live at https://site/your-post/*** — a real link, verified reachable before it's shown.
- Build failures are translated to human terms ("your post's front matter has a stray quote on line 3"), with a one-click revert that commits the previous file content back.

**Finding the live URL: sitemap first, derivation second.** Deriving the URL from `_config.yml` means reimplementing Jekyll's permalink resolution — pretty/date/custom styles, categories in the path, `baseurl`, CNAME custom domains — and every edge case missed is a broken promise in the one feature that justifies the project. Instead, once the build passes, fetch the site's `sitemap.xml` (or `feed.xml`) and locate the new entry: **Jekyll computed that URL itself, so it is authoritative.** `_config.yml` derivation survives only as a fallback when no sitemap plugin is present, and for the pre-publish preview, where a wrong guess is cheap.

**A green build does not mean the post is live.** Three ways the journey ends in a passed build and an absent post, each of which must be detected and explained rather than left to spin:
- **`future: false`** (Jekyll's default) silently skips posts dated ahead of the build clock. Publishing at 11pm in a UTC+ zone dates the post tomorrow — build passes, post never appears. Timezones make this routine, not exotic.
- **`published: false`** in front matter does the same thing, deliberately.
- **No Pages build configured at all.** An empty `?head_sha=` run list is indistinguishable from "the workflow hasn't registered yet" without a timeout heuristic. Handle both branch-based (`pages-build-deployment`) and Actions-source deploys.

**The liveness check has origin and cache traps.** Admin at `/admin/` fetching a post on the same site is same-origin and fine — but a CNAME custom domain can place admin on a different origin than the published site, and the cross-origin fetch then fails. `no-cors` is not a workaround: an opaque response has no readable status, so it can verify nothing. Needs a cache-buster, too, against the CDN serving a stale 404 from a pre-publish probe.

### Editor

Markdown `<textarea>` + live side preview (micromark or marked) + a minimal toolbar (bold, link, image, heading). No block editor, no WYSIWYG framework. Image insert = upload to `assets/img/...` + inserted markdown reference.

### Setup wizard (first run)

Checks the repo has GitHub Pages enabled and a build workflow. Where the API can't act with a PAT's permissions, it shows click-here GitHub UI instructions with live verification checks ("✓ Pages is enabled" turns green when done).

Worth verifying before writing that flow: `POST /repos/{owner}/{repo}/pages` with Pages:write may let the wizard enable Pages directly, deleting a manual step rather than narrating it.

### Stack

TypeScript + Preact (~4 kB runtime). No React. Bundle budget ~100 kB gzipped total, enforced in CI when code exists.

## MVP phases

1. **Core loop:** PAT auth → list posts → edit/create → commit → deploy status → verified live link.
2. **Content comfort:** drafts flow, image upload + insertion, front-matter inference, conflict handling, one-click revert.
3. **Onboarding:** setup wizard, PAT-expiry reminders, optional one-file Cloudflare Worker OAuth for teams, pages/data-file editing.

## Known risks and accepted limits

- **PAT lifecycle:** fine-grained tokens expire (≤ 1 year). Detect 401s and re-prompt gracefully. Tokens are per-user credentials — never shared; each editor needs push access and their own PAT.
- **API size limits:** base64 payloads; ~100 MB/file write ceiling — fine for blog media. The **1 MB read ceiling** on the Contents API is the one that actually bites; see content operations.
- **Token storage:** PAT in `localStorage` on a public site's `/admin/` path. The app must be fully self-contained (no third-party scripts at runtime), and the threat model documented for users. The sharper edge than third-party scripts: **`username.github.io` is a single origin shared by every project page that user publishes.** Any other repo of theirs served from that subdomain can read the admin page's `localStorage` and with it a token that has write access to the site repo. Users on the default subdomain must be told this plainly.
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
| Write API | Git Data API, not Contents | Contents is one-file-per-commit with no move: publish would be a non-atomic create+delete that can leave a duplicate post live. Git Data buys atomic multi-file commits for 6 calls per save (~4 with caching). Prototype-verified, including that a fine-grained PAT's `contents: write` reaches the endpoints |
| Live-URL discovery | `sitemap.xml`, not `_config.yml` | Jekyll already computed the URL; deriving it means reimplementing permalink styles, `baseurl`, categories, and CNAME handling, and owning every edge case |
| Distribution | In-repo `/admin/` | Decap-familiar, host-agnostic, owner pins the version; no central service to run or trust |
| Stack | TypeScript + Preact | ~4 kB runtime, JSX ergonomics, fits the size budget |
| Editor | textarea + preview | Minimalism over WYSIWYG; block editors are where CMS bundles go to bloat |
| Front matter | `yaml` CST API, ~30 kB gz | Only route that preserves formatting byte-for-byte; the AST API launders files. Prototype-verified — costs 2× the original estimate, still inside budget |
