# ADR-0003: Build standalone, rather than forking Decap or writing a Decap backend

- **Status:** Accepted
- **Date:** July 2026

## Context

The project's goal is a Git-based CMS for Jekyll sites on GitHub Pages that brings content across the finish line: a non-technical user writes a post, hits Publish, and watches it go live, with zero git knowledge, zero servers, zero config files.

Decap CMS occupies this space already, so building separately needs justification. The initial instinct — that Decap fails at the *publish* step — is wrong. Decap's editorial workflow already gives a UI Publish button that commits and merges via the GitHub API. The real developer dependencies are elsewhere:

1. **Auth.** Decap's GitHub backend requires a server-side OAuth client — historically Netlify's shared service (unreliable since the community handoff), otherwise a self-hosted worker or lambda. A static GitHub Pages site cannot host one, so every install needs a developer to stand up auth infrastructure.
2. **Setup.** A hand-authored `config.yml` defining collections, fields, and widgets. Developer-shaped work before the first post can be written.
3. **Failure modes.** Build breaks, YAML syntax errors, and edit conflicts surface in git and CI vocabulary. Nothing closes the loop by telling the writer "your post is now live at this URL."

So the thesis sharpens to: **eliminate the server, eliminate the config, and own the post-publish feedback loop.**

## Decision

Build a standalone application. Do not fork Decap, and do not write a Decap custom backend.

## Rationale

### Fork Decap

*For:* full widget set, editorial workflow, i18n, media library, a config format people know, an existing ecosystem.

*Against, disqualifying:*

- It is a large legacy React/Redux monorepo — dozens of packages, multi-MB bundle, a mid-flight Slate→Plate editor migration. "Incredibly minimal" would mean gutting it, which is a rewrite carrying a fork's maintenance burden.
- Upstream development slowed materially after Netlify handed the project to the community (now agency-led). A fork would track a slow-moving upstream while diverging on architecture.
- The friction being fixed — server-required auth, config-first setup — is architectural and spread through core. It is a redesign, not a patch.

### Decap plugin or custom backend

*For:* in theory the least code. Auth lives in the backend layer, so a PAT-based backend is the "right" seam; it reuses the entire Decap UI and is potentially upstreamable.

*Against, disqualifying:*

- Decap has **no finalized or documented custom-backend API** (decap-cms issues #1601, #6526). A custom backend means reverse-engineering the internal class interface from the GitHub backend's source, with no stability contract.
- Even a perfect zero-server backend still ships Decap's bundle weight and `config.yml` complexity. Setup stays developer-shaped, which violates the core goal.
- The finish-line UX — deploy status, verified live link — has no extension point at all. It would need core patches, which is forking again.

## Prior art

- **Sveltia CMS** (github.com/sveltia/sveltia-cms) — the modern Decap-compatible rewrite and de-facto successor. Already does serverless PAT sign-in, including a token-page deep link with scopes preselected; that flow was taken wholesale (see ADR-0004, which uses the newer fine-grained template URLs). It remains `config.yml`-driven and SSG-agnostic: no zero-config Jekyll awareness, no deploy feedback. Sveltia is the quality bar.
- **Pages CMS** (pagescms.org) — the closest target *UX* (non-technical editors, GitHub App auth, invite-by-email) but the wrong shape: a hosted service, requiring Postgres and a GitHub App to self-host. It proves the demand exists.

## Consequences

- Three differentiators justify the separate project: zero-config Jekyll conventions, finish-line publish UX, and guided GitHub Pages setup.
- **If those evaporate, so does the project.** If the itch turns out to be fully scratched by Sveltia plus a setup wizard, contribute there instead.
- Everything Decap provides for free — widget set, i18n, media library, editorial workflow — must be either rebuilt or deliberately scoped out. Most is scoped out (see ADR-0021 on the editor, and the review-workflow limit in `docs/DESIGN.md`).
