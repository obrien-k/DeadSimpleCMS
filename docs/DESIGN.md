# finish-line — Design Document

*Status: design phase. No code exists yet. Working title from the project thesis; rename freely.*

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

- **Sveltia CMS** (github.com/sveltia/sveltia-cms) — the modern Decap-compatible rewrite and the de-facto successor. Already does serverless **PAT sign-in**, including a token-page deep link with the required scopes preselected — steal that flow wholesale. Plans to drop its optional auth worker once GitHub ships client-side PKCE. But it remains `config.yml`-driven and SSG-agnostic: no zero-config Jekyll awareness, no deploy feedback. Sveltia is the quality bar, not the competition.
- **Pages CMS** (pagescms.org) — the closest target *UX* (non-technical editors, GitHub App auth, invite-by-email) but the wrong shape: a hosted service, with Postgres + a GitHub App required to self-host. It proves the demand exists; it is not minimal.
- **Honest fallback:** if during the build the itch turns out to be fully scratched by Sveltia plus a setup wizard, contribute there instead. The differentiators that justify a separate project are exactly three: zero-config Jekyll conventions, finish-line publish UX, and guided GitHub Pages setup. If those evaporate, so does the project.

## Architecture

**One static admin page. No server. No database. No build service.**

### Form factor

One HTML file at `/admin/index.html` in the user's site repo, loading a pinned, versioned JS bundle. The page is excluded from Jekyll layout processing (front-matter-free HTML passes through untouched). It works on any theme because it never touches the theme — it only reads and writes content files via the GitHub API.

### Auth: fine-grained PAT, guided

- Fine-grained GitHub personal access token, scoped to the one site repo. Permissions: Contents read/write, Actions read, Pages read, Metadata read.
- Guided creation: a deep link to GitHub's token page with scopes preselected (the Sveltia flow), paste once, stored in `localStorage`.
- This works because `api.github.com` sends CORS headers — a static page can call the REST API directly. GitHub's **device flow is not browser-usable** (no CORS on the token endpoint), which is why PAT is the zero-infrastructure choice. An optional one-file Cloudflare Worker OAuth (for teams) and client-side PKCE (if/when GitHub ships it) are later add-ons, not MVP.

### Content operations: GitHub REST Contents API only

- List `_posts/` and `_drafts/`; read, write, and rename files; upload images to `assets/`.
- Every write is compare-and-swap on the blob `sha` the API returned at read time — concurrent edits surface as a plain-language conflict ("this post changed since you opened it"), never silent clobbering.

### Jekyll-aware, zero config

- Conventions hardcoded: date-prefixed `_posts/YYYY-MM-DD-slug.md` filenames, `_drafts/` for drafts, a front-matter form (title, date, description, tags, categories, cover image), permalink preview derived from `_config.yml`.
- Extra front-matter fields are **inferred by sampling the repo's existing posts** — no schema file, ever. A site whose posts all carry `image.path` gets that field in the form.
- **Round-trip safety is a hard invariant:** unknown front-matter keys and formatting are preserved verbatim. Opening and saving a file the owner hand-edits elsewhere must never launder it. (Implementation consequence: front matter is edited as a keyed patch over the original YAML text, not parsed-and-redumped.)

### Publish = the finish line (the differentiator)

- Draft → Publish moves `_drafts/x.md` → `_posts/YYYY-MM-DD-x.md` in one commit to the default branch.
- The app then polls `GET /repos/{owner}/{repo}/actions/runs?head_sha=…` plus the Pages API and renders the journey: *Publishing… → Build passed → **Live at https://site/your-post/*** — a real link, verified reachable before it's shown.
- Build failures are translated to human terms ("your post's front matter has a stray quote on line 3"), with a one-click revert that commits the previous file content back.

### Editor

Markdown `<textarea>` + live side preview (micromark or marked) + a minimal toolbar (bold, link, image, heading). No block editor, no WYSIWYG framework. Image insert = upload to `assets/img/...` + inserted markdown reference.

### Setup wizard (first run)

Checks the repo has GitHub Pages enabled and a build workflow. Where the API can't act with a PAT's permissions, it shows click-here GitHub UI instructions with live verification checks ("✓ Pages is enabled" turns green when done).

### Stack

TypeScript + Preact (~4 kB runtime). No React. Bundle budget ~100 kB gzipped total, enforced in CI when code exists.

## MVP phases

1. **Core loop:** PAT auth → list posts → edit/create → commit → deploy status → verified live link.
2. **Content comfort:** drafts flow, image upload + insertion, front-matter inference, conflict handling, one-click revert.
3. **Onboarding:** setup wizard, PAT-expiry reminders, optional one-file Cloudflare Worker OAuth for teams, pages/data-file editing.

## Known risks and accepted limits

- **PAT lifecycle:** fine-grained tokens expire (≤ 1 year). Detect 401s and re-prompt gracefully. Tokens are per-user credentials — never shared; each editor needs push access and their own PAT.
- **Contents API limits:** base64 payloads, ~100 MB/file ceiling — fine for blog media.
- **Token storage:** PAT in `localStorage` on a public site's `/admin/` path. The app must be fully self-contained (no third-party scripts at runtime), and the threat model documented for users.
- **No review workflow in MVP:** commits go straight to the default branch. An editorial/PR workflow is explicitly out of scope until later phases.

## Verification plan (for the eventual implementation)

- Drive the full loop against a scratch `jekyll new` repo with a GitHub Pages workflow — **never a production site**: create draft → edit → publish → watch status → confirm the post is live at the reported URL.
- **Round-trip test:** hand-write a post with exotic front matter (nested keys, comments, odd spacing); open and save it in the CMS; `git diff` must be clean except the intended edits.
- **Theme-agnostic check:** repeat the loop on Minima and on a Hydejack site (read-only browse + one throwaway draft).
- **Budget check:** built bundle ≤ ~100 kB gzipped.

## Decision log

| Decision | Choice | Why |
|---|---|---|
| Build vs fork vs plugin | Standalone | Decap fork = rewrite with fork burden; plugin = undocumented backend API + still ships Decap's weight |
| Auth (MVP) | PAT-only, guided | Zero infrastructure; device flow is CORS-blocked in browsers; OAuth worker deferred to phase 3 |
| Distribution | In-repo `/admin/` | Decap-familiar, host-agnostic, owner pins the version; no central service to run or trust |
| Stack | TypeScript + Preact | ~4 kB runtime, JSX ergonomics, fits the size budget |
| Editor | textarea + preview | Minimalism over WYSIWYG; block editors are where CMS bundles go to bloat |
