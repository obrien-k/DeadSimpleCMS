# ADR-0005: Token over-scope is undetectable — check the decidable subset and say so

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #7
- **Code:** `src/app/token.ts`, `src/gh/`
- **Related:** ADR-0004 (PAT auth)

## Context

ADR-0004 leaves repository selection to a manual dropdown, because the token template URL cannot pre-fill it. The design originally promised the app would verify the token was correctly scoped and warn if it was not.

That promise cannot be kept.

## Decision

**Run no scope check.** Struck the design's promise to verify rather than rewording it.

Run the decidable subset of first-use checks instead:

- **Classic token (`ghp_` prefix) → refuse.** All-repositories by construction, so the prefix convicts it offline, in zero API calls. This is the likeliest real over-scope in practice — an old token, pasted — so the free check covers the common case.
- **`github-authentication-token-expiration` response header → warn before the 401**, not after. Free on every response, and it means expiry never has to be guessed from the template URL's `expires_in`; the token reports its own.
- **A dangling-blob `POST git/blobs` → proves the token can actually write here.** One call; the blob is referenced by no tree and is garbage-collected.

## Evidence

Prototype-verified (`prototype/token-scope/`, July 2026). A token scoped to *all* repos is indistinguishable from a correctly-scoped one when probed against the site repo:

- `permissions` on the repo response reports **the user's role, not the token's grant** — byte-identical across two tokens on two accounts.
- A write probe succeeds in both cases.
- Breadth is only visible by proving the token *cannot* reach some *other* repo — and a fine-grained PAT **cannot enumerate private repos**: `/user/repos` returns public repos only, regardless of scope. So the app can never discover a repo to test against.

The probe works. Discovery is impossible.

## Consequences

- **The guarantee rests entirely on the user's dropdown choice.** If a user grants "All repositories", the app cannot tell and will never warn. The install-time callout is the only mitigation that exists, which is why it has to be loud.
- **The blob probe deliberately does not distinguish its failure causes.** "Wrong repo", "not scoped to this repo", and "missing `contents: write`" all 404 alike — GitHub does this on purpose, so as not to leak whether a private repo exists. Report all three in one message rather than inventing a distinction the API refuses to make.
- **The risk is latent and scales with the account.** Severity tracks how many repos the owner has, so the target persona — a blogger whose only repo is their site — is barely exposed at install: an "All repositories" token over one repo has the same blast radius as a correctly-scoped one, and the shared-origin hole in ADR-0004 needs a second Pages site to exploit.
- **That safety is a snapshot, not a property.** A fine-grained PAT scoped to "All repositories" also covers repos that *do not exist yet*. The day the owner creates a second repo, a token stored a year ago silently gains write access to it — no prompt, no re-consent, and no way to detect it. Publishing a second Pages site opens the origin hole retroactively for a token already in storage. The exposure grows while nobody is looking, which is why the dropdown callout matters most for the user least able to judge it. Seasoned multi-repo users carry the risk from day one and are likelier to spot it; the intended user carries it later and will not.
