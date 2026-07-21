# ADR-0018: Ship `/admin/` in the owner's repo, with a vendored bundle — no CDN

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #2 (repo identity), #3 (distribution)
- **Code:** `admin/`, `vite.config.ts`
- **Related:** ADR-0019 (install and update), ADR-0020 (HTTPS)

## Context

The app is one static admin page with no server, no database, and no build service. Two questions follow: where does it live, and where does its code come from at runtime?

## Decision

**One HTML file at `/admin/index.html` in the user's site repo, loading a vendored bundle committed beside it at `/admin/bundle.js`.** Nothing is fetched from a third party at runtime.

The page is excluded from Jekyll layout processing — front-matter-free HTML passes through untouched. It works on any theme because it never touches the theme; it only reads and writes content files via the GitHub API.

**`index.html` is the config anchor; `bundle.js` is the only replaceable part.** `index.html` carries the `owner/repo` config line and is written *only* by the installer. Self-update rewrites `bundle.js` alone, so the identity the app was installed against cannot drift underneath it.

## Rationale

**In-repo distribution** is Decap-familiar, host-agnostic, and lets the owner pin the version. There is no central service to run or trust.

**Vendoring dominates a CDN, and the usual trade is false here.** The design already pins the version, which is the CDN's only real advantage:

| Option | Cost |
|---|---|
| **Vendored** | An edit to update |
| Pinned CDN + SRI | The *same* edit to update, plus an availability dependency and a trust surface |
| Unpinned CDN | A third party mutating code on a page that holds a write PAT |

**A wrong `owner/repo` line is a hard error with no override**, which is why only the installer writes `index.html` (ADR-0019 explains why the installer exists at all).

## Consequences

- The bundle must be fully self-contained — no third-party scripts at runtime. That constraint is what makes the ~100 kB budget (ADR-0021) binding rather than advisory.
- Updating means committing a new `bundle.js` into the owner's repo. ADR-0019 covers how, and what cannot be guaranteed about it.
- Because `/admin/` lives *in* the site, it is always same-origin with the posts, which is what makes ADR-0013's liveness check trivially readable.
