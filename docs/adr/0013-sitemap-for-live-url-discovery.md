# ADR-0013: Find the live URL in `sitemap.xml`, cross-checked against `environment_url`

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #4
- **Code:** `src/finishline/`
- **Related:** ADR-0014 (build tracking)

## Context

The finish line is the differentiator: *Publishing… → Build passed → **Live at https://site/your-post/***, with a real link, verified reachable before it is shown.

That requires knowing the post's URL. Deriving it from `_config.yml` means reimplementing Jekyll's permalink resolution — pretty, date and custom styles, categories in the path, `baseurl`, CNAME custom domains — and every edge case missed is a broken promise in the one feature that justifies the project.

## Decision

Once the build passes, fetch the site's `sitemap.xml` (or `feed.xml`) and locate the new entry. **Jekyll computed that URL itself, so it is authoritative.**

**Cross-check each `<loc>` against the deployment's `environment_url`.** If it does not start with it, the sitemap is misconfigured, and *that* is the error to explain.

`_config.yml` derivation survives only as a fallback when no sitemap plugin is present, and for the pre-publish preview, where a wrong guess is cheap.

## Evidence

Prototype-verified (`prototype/finish-line/`, July 2026) against a public scratch site on a custom domain with a branch-based build:

- `jekyll-sitemap` is whitelisted on the branch-based builder, the post is listed by the time the build succeeds, and the declared URL resolves.
- With no plugin, `sitemap.xml` returns 404 — cleanly detectable.
- **`environment_url` on the deployment status is GitHub stating the site root** — no derivation, no `_config.yml` parsing.
- The whole publish loop takes ~40–60s: the deployment appears ~3s after the commit, the build completes in 37–58s, and the post is live *and* in the sitemap by the time the build reports success.

## The sitemap is authoritative about Jekyll, not about reality

It faithfully reproduces the user's misconfiguration. `jekyll-sitemap` builds each `<loc>` from `site.url` + `site.baseurl` + `page.url`, so a project page with `baseurl` unset emits URLs missing the `/<repo>` prefix and **every one of them 404s**. That is the most common Jekyll project-page mistake, it is invisible from inside the site (links work when clicked from within it), and nothing warns.

Trusting the sitemap blindly means confidently reporting "live at ‹url›" pointing at a 404 — worse than reporting nothing. Hence the `environment_url` cross-check, whose error message names the actual cause ("your `_config.yml` has `baseurl` unset"). First concrete entry in the error-translation vocabulary.

## The sitemap doubles as the trap detector

**A green build does not mean the post is live.** Prototype-verified: on a green build, both traps below return **404** *and* are **absent from `sitemap.xml`**. So a passed build plus a URL missing from the sitemap means Jekyll deliberately skipped the post — the difference between "still building" and "built, and silently dropped".

**No API call is needed to explain which:** the app wrote the front matter, so it already knows. The sitemap says *that* it was skipped; local state says *why*.

- **`future: false`** (Jekyll's default) silently skips posts dated ahead of the build clock. Publishing at 11pm in a UTC+ zone dates the post tomorrow — build passes, post never appears. Timezones make this routine: **the prototype written to test this trap fell into it**, by building a date from `toISOString()` (UTC) while the local clock still read yesterday.
- **`published: false`** in front matter does the same thing, deliberately.
- **No Pages build configured at all.** `GET /repos/{owner}/{repo}/pages` → **404** answers it in one call, before any polling — categorically distinct from "the deployment hasn't registered yet".

## Consequences

- **The liveness check's origin trap does not exist.** Pages sends `access-control-allow-origin: *` on content, so a normal `fetch()` reads the status cross-origin; `no-cors` and its unreadable opaque response are never needed. It is moot anyway: `owner.github.io/repo/` 301-redirects to the custom domain, so `/admin/` (which lives *in* the site) is always same-origin with the posts. Genuine cross-origin requires the sitemap to name a different host — the misconfiguration above, now detected.
- **The cache trap is narrower than it looks.** 404s carry no `cache-control` and do not go stale, so a pre-publish probe cannot poison the post-build check and a cache-buster is not required. **200s do carry `max-age=600`** — irrelevant to liveness, but *editing* an existing post can serve stale content for ~10 minutes, which the "verified live link" UX must not promise away.
