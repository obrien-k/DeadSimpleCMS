# ADR-0019: A hosted installer used once; self-update with no integrity check, stated plainly

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #3, #8 (collision handling), #29 (the wizard)
- **Code:** `src/installer/`, `vite.installer.config.ts`
- **Related:** ADR-0018 (what gets installed), ADR-0004 (the PAT)

## Context

ADR-0018 puts `/admin/index.html` + `/admin/bundle.js` in the owner's repo, with `index.html` carrying an `owner/repo` line that is fatal if wrong. Getting those two files there — and replacing the bundle later — is the remaining problem, for a user who cannot use git.

## Decision

### Install: a hosted installer page, used once

Paste PAT + repo; it commits `/admin/` via the API.

Chosen over a zip-drag install **because of repo identity**: a wrong config line is a hard error with no override, so any flow where the owner *hand-types* `owner/repo` manufactures exactly that fatal case. An API-based installer writes the line correctly by construction, deleting the failure mode rather than documenting it.

It must hold the PAT **in memory only** — never `localStorage` or `sessionStorage` — because it is hosted on a `github.io` origin shared with other project pages (the same hazard as ADR-0004's storage note).

### Update: the app commits its own successor

It already holds `contents: write`. The new bundle is fetched **unauthenticated** from the public project repo via `api.github.com`, which sends `access-control-allow-origin: *` — verified. No CDN is needed for this, which removes the last argument for one.

### Update integrity: none is possible, and this is stated rather than dressed up

Two designs were considered and rejected as security theatre:

- **A hash check is circular.** Bundle and hash share a source, so a compromised source serves a matching hash.
- **A TOFU signature chain** (public key pinned in `index.html`, each version verifying the next) only helps if the private key lives somewhere GitHub cannot reach. This project would sign in CI, where an attacker holding the repo can read the secret or simply trigger the signing workflow. It would prove "this came through our CI", not "the maintainer approved it" — precisely the claim a repo compromise falsifies.

**The honest statement:** every install runs code this repo serves, so a compromise here reaches every install that clicks update. That is the deal with any self-updating software. The mitigation is that the update is explicit and user-initiated, never silent.

### The installer is also the repair tool

A bad update can brick the only tool a git-averse owner has to fix it, so the installer stays reachable: point it at the repo again and it reinstalls a known-good `/admin/` and re-roots trust.

Keeping the N-1 bundle committed was rejected — recovery would mean flipping a reference in `index.html`, the exact git operation the owner cannot perform.

## On "no central service to run or trust"

The installer does not breach that rule. The rule is about *runtime*, and at runtime there is still nothing but the owner's own repo. The installer is a static page, used once, never contacted again, and it introduces no new trust party — it is the same authors whose bundle you are installing regardless.

## Build and hosting

The installer is a **second build output of this repo**: `vite.config.ts` builds the vendored `/admin/` library bundle; `vite.installer.config.ts` builds the installer site to `dist-site/`, carrying the bundle and the `admin/index.html` template as install payloads.

Pages for this repo uses **GitHub Actions**, not deploy-from-branch — the installer is TypeScript that must be built, and a branch deploy would run the output through Jekyll.

The #29 flow: repo → guided PAT → preflight → #8 collision handling → a two-file install commit → a watched build ending on the live link.

## Consequences

- **Prerequisite: the project repo must be public** before either the installer or self-update can work.
- **Self-update makes this project a supply chain, and nothing available fixes that.** Every install carries a `contents: write` PAT, so a compromise reaches every user who clicks update, with write access to their site. The real mitigations are ordinary: protect the repo and the release path, and keep updates explicit so a bad version reaches only those who act, and only after it has been published long enough to be noticed. Worth revisiting if signing ever moves offline.
- The setup wizard shows click-here GitHub UI instructions with live verification checks ("✓ Pages is enabled" turns green when done) wherever the API cannot act with a PAT's permissions.
