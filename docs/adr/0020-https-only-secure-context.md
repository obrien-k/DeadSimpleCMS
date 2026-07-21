# ADR-0020: `/admin/` hard-refuses to run outside a secure context

- **Status:** Accepted
- **Date:** July 2026
- **Code:** `src/app/`, `src/installer/preflight.ts`
- **Related:** ADR-0004 (the PAT in `localStorage`)

## Context

`/admin/` holds a personal access token with write access to the owner's site repo. A page served over plain HTTP can be MITM'd and handed a token-stealing script.

## Decision

**Refuse to run outside a secure context.** No override, no "continue anyway".

**The setup wizard must verify Enforce HTTPS is on and block until it is.**

## Rationale

Every other defence here is theatre if this one is absent. The API calls being HTTPS is irrelevant once the attacker is running *in the page* — they inherit the token and the origin.

**"Built, but plain HTTP" is a real state a real user hits**, not a hypothetical. GitHub cannot enforce HTTPS on a custom domain until its certificate provisions, so there is a genuine window while the owner waits. Observed live: Pages defaults `https_enforced: false` on a custom domain until the cert provisions.

## Consequences

- A user on a freshly-configured custom domain is blocked until the certificate lands. The wizard must explain *that*, rather than reporting a generic failure — the state is temporary and the user's action is to wait.
- Local development must run over `localhost`, which browsers already treat as a secure context.
