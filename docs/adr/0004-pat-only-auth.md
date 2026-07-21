# ADR-0004: Fine-grained PAT auth, guided — no OAuth, no worker

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #31 (OAuth worker ruled out of scope)
- **Code:** `src/app/token.ts`
- **Related:** ADR-0005 (scope is unverifiable), ADR-0020 (HTTPS-only)

## Context

Auth is the reason a static Git-based CMS normally needs a server (ADR-0003). GitHub's OAuth web flow needs a server-side client secret, and **GitHub's device flow is not browser-usable** — the token endpoint sends no CORS headers. `api.github.com` itself does send CORS headers, so a static page can call the REST API directly once it holds a credential.

That leaves the personal access token as the only zero-infrastructure credential.

## Decision

A **fine-grained GitHub personal access token**, scoped to the one site repo, created through a guided flow and stored in `localStorage`.

Permissions requested: Contents read/write, Actions read, Pages read, Metadata read.

Guided creation uses a **template URL** that pre-fills the token form:

```
https://github.com/settings/personal-access-tokens/new
  ?name=DeadSimpleCMS
  &description=Lets+DeadSimpleCMS+publish+posts+to+your+site
  &target_name={owner}
  &expires_in=365
  &contents=write
  &actions=read
  &pages=read
```

**Multiple editors need no server: each brings their own fine-grained PAT**, scoped to the repo, through the same guided flow run once per person. That is the whole team story today.

## Evidence

Verified July 2026. GitHub shipped template URLs for fine-grained PATs in [August 2025](https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/). The form accepts `name`, `description`, `target_name` (user or org slug), `expires_in` (1–366, or `none`), and one parameter per permission.

- `{owner}` is known by the time we ask, so the link is built at runtime.
- `metadata=read` is implicit — GitHub mandates it whenever other repository permissions are requested.
- **`expires_in=365`, not the 366 ceiling.** An account or org "maximum lifetime" policy set to 365 rejects 366 — a real account hit this in dogfooding. 365 is valid under both the default and a 365 cap.
- Prefer a real expiry over `none`: a non-expiring token on a public site's `/admin/` is a liability.
- **The permission set is not fully verified.** The finish-line prototype reads `/deployments` with it, but the scratch repo is public, and an unauthenticated request reads `/deployments` and `/actions/runs` just as well — so that success proves only that the repo is public. Whether a **private** site repo needs `Deployments: read` (not requested here) is untested. Not MVP-blocking: Pages' free tier requires public.

## Consequences

- **The token cannot be scoped to the repo by the URL.** There is no `repositories` or `repository_ids` parameter, so repository selection stays a manual dropdown choice. The UI must call it out explicitly ("choose **only** {repo} under Repository access"). That dropdown is the only enforcement point — see ADR-0005.
- **PAT lifecycle:** fine-grained tokens expire within a year. The `github-authentication-token-expiration` response header carries the expiry on every call, so warn ahead of time and treat a 401 as the fallback rather than the trigger.
- **Token storage is `localStorage` on a public site's `/admin/` path.** The sharper edge than third-party scripts: `username.github.io` is a single origin shared by every project page that user publishes. Any other repo of theirs served from that subdomain can read the admin page's `localStorage`, and with it a token holding write access to the site repo. Users on the default subdomain must be told this plainly.
- **The Cloudflare Worker OAuth is out of scope (#31).** Under either ownership model it breaks a founding constraint: one Worker *we* host is a hosted service, with an OAuth app and client secret to operate and secure; a Worker each owner deploys is exactly the infrastructure work this project exists to spare a blogger. Neither survives both constraints, and no team has asked.
- **The one open door is a CORS-usable browser-native flow.** If GitHub ships client-side PKCE, browser-native OAuth returns. The Worker does not.
