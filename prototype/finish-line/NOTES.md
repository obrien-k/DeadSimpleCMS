# Prototype: the finish line

**Status: answered. The finish line works — but not the way #4 specified it.**
Delete this directory once the findings land in the real code.

Run against `obrien-k/deadsimplecms-scratch` (public, custom domain
`kyleobrien.me`, `build_type: legacy`) with the fine-grained PAT from
`prototype/git-data-move`.

## Verdict

**Publishing → build → live URL is real and fast: ~40–60s end to end.** Three of
#4's four questions had premises that did not survive contact:

| # | #4 assumed | Measured |
|---|---|---|
| 1 | poll `/actions/runs?head_sha=` | **use the Deployments API** — one endpoint, both build types, and it hands you the site URL |
| 2 | sitemap-first finds the URL | it does — **but the sitemap inherits the user's `url`/`baseurl` mistakes and silently emits URLs that 404** |
| 3 | cross-origin needs `no-cors`, response is opaque, cannot verify | **false** — Pages sends `access-control-allow-origin: *`; a normal fetch reads the status |
| 4 | future-dated / `published:false` are silent traps | **confirmed** — and the sitemap is the detector |

## 1. Run polling: use Deployments, not Actions runs

**The "no Pages at all" discriminator is one call, before any polling:**
`GET /repos/{o}/{r}/pages` → **404 = Pages is not configured.** That is
categorically distinct from "the run has not registered yet", and it cannot be
confused with a slow build. (Verified: this endpoint 404'd on the scratch repo
before Pages was enabled, 200 after.)

**Then use the Deployments API, not `/actions/runs`:**

```
GET /repos/{o}/{r}/deployments?sha={sha}&environment=github-pages
GET /repos/{o}/{r}/deployments/{id}/statuses
    → waiting → queued → in_progress → success
    → environment_url: "https://kyleobrien.me/deadsimplecms-scratch/"
```

Three reasons this beats the Actions route, which is what #4 asked for:

1. **`environment=github-pages` is stable across both build types.** A
   branch-based (`legacy`) deploy and an Actions-source deploy both produce a
   `github-pages` deployment. One code path, no branching on `build_type`.
2. **It sidesteps the workflow-identification problem.** For `legacy`, the run is
   synthetic: `event: dynamic`, `path: dynamic/pages/pages-build-deployment` —
   **not a real file in `.github/workflows/`**, so any logic that looks for a
   workflow file finds nothing. For Actions-source, the opposite problem: a sha
   may have several runs (tests, lint, deploy) and "which one is the Pages build?"
   has no reliable answer. Deployments never asks the question.
3. **`environment_url` is GitHub telling you the site root.** No deriving it, no
   reading `_config.yml`. See §2 — this turns out to be the fix for the sitemap's
   worst failure mode.

**Timing** (legacy, small site): deployment/run appears **~3s** after the commit;
build completes in **37–58s**; the post is live and in the sitemap by the time the
build reports success.

**Not verified: Actions-source.** The scratch repo is `legacy` and this PAT cannot
switch it — `POST /repos/{o}/{r}/pages` needs `pages: write` (design grants
`pages: read`), and committing `.github/workflows/*` needs the fine-grained
`workflows` permission, which the design does not request at all. Testing it needs
a second scratch repo configured by hand. The deployment-based approach is
*designed* to be build-type agnostic, but that claim is reasoned, not measured.

## 2. Sitemap works — and inherits the user's misconfiguration

`jekyll-sitemap` is whitelisted on the `legacy` builder, produces `sitemap.xml`,
and the new post appears in it by the time the build succeeds. The URL it declares
resolves. **Sitemap-first URL discovery works.**

**But it is only as correct as the user's `_config.yml`.** The scratch repo shipped
with `baseurl: ""` while being served under `/deadsimplecms-scratch/`. Jekyll does
not care — Pages serves files at `/<repo>/…` regardless — but **`jekyll-sitemap`
builds its `<loc>` from `site.url` + `site.baseurl` + `page.url`**, so an unset
`baseurl` on a project page emits URLs missing the `/<repo>` prefix. Every one of
them 404s.

This is not exotic: it is the single most common Jekyll project-page
misconfiguration, the site *looks* fine (pages resolve when clicked from the site
itself), and nothing warns. A CMS that trusts the sitemap inherits the bug and
reports "live at ‹url›" pointing at a 404.

**Mitigation, free:** the deployment's **`environment_url` is the true site root**.
Cross-check the sitemap's `<loc>` against it — if a `<loc>` does not start with
`environment_url`, the sitemap is misconfigured, and *that* is the error to explain
("your `_config.yml` has `baseurl` unset"), not a bare failed liveness check.

`setup.js` derives `url`/`baseurl` from the Pages API precisely so this prototype
measures the happy path rather than the bug.

**Fallback (no plugin):** `GET sitemap.xml` → **404**, observed before `setup.js`
added the plugin. Cleanly detectable; the fallback path itself is untested here.

## 3. Liveness: the cross-origin problem does not exist

**#4's premise is false.** GitHub Pages sends **`access-control-allow-origin: *`**
on real content responses (verified on a 200 with a foreign `Origin` header). So a
normal `fetch()` in CORS mode reads the status cross-origin. `no-cors` and its
opaque response are never needed, and the "cannot verify anything" problem
evaporates.

**It is moot twice over:** `https://obrien-k.github.io/deadsimplecms-scratch/`
**301-redirects to the custom domain**, so `/admin/` — which lives *in* the site —
always ends up on the same origin as the posts. Being cross-origin requires the
sitemap to declare a *different host* than the one the admin page is loaded from,
i.e. a misconfiguration, which §2 already catches.

**Caching, measured properly:**

```
pre-build probe:  404 | cache-control: null | age: 0
at first-200:     plain=200 (age=0)  vs  cache-busted=200
```

**404s carry no `cache-control` and did not go stale.** A pre-publish probe does
*not* poison the post-build check, so cache-busting is not mandatory for liveness.

*(Note the first version of this harness probed **after** waiting for the build,
found 200, and "passed" without ever creating a 404 to go stale. It proved nothing.
The probe must fire immediately after the commit.)*

**200s do carry `cache-control: max-age=600`.** Irrelevant to liveness (404→200),
but it means **editing an existing post can serve stale content for ~10 minutes** —
a different problem, and one the "verified live link" UX should not accidentally
promise away.

## 4. The traps are real, and the sitemap detects them

Both traps, on a **green** build:

| trap | live URL | in sitemap |
|---|---|---|
| future-dated (`future: false` default) | **404** | **absent** |
| `published: false` | **404** | **absent** |

**Sitemap absence is the detection signal.** A green build plus a URL missing from
`sitemap.xml` means Jekyll deliberately skipped the post — that is the difference
between "still building" and "built, and silently dropped".

**The app does not need the API to explain why.** It wrote the front matter, so it
already knows whether the date is in the future or `published: false` is set. The
sitemap says *that* it was skipped; local state says *why*. No extra call.

So the sitemap does double duty: URL discovery (§2) **and** trap detection.

**The future-dating trap caught this harness.** The first run built the date with
`new Date().toISOString()` — **UTC** — and stamped the post `12:00:00 +0000`. UTC
had already rolled over to the next day while the clock was before noon, so the
post was silently future-dated, Jekyll dropped it, and the run burned 245s waiting
for a page that would never exist. A harness written specifically to test this trap
fell into it. If it catches someone actively looking for it, it catches a blogger
every time — this is the strongest evidence yet that the finish line is worth
building.

## Corrections for DESIGN.md

- **Live-URL discovery via `sitemap.xml` is right, but incomplete.** The decision log
  credits it with avoiding permalink/`baseurl`/CNAME reimplementation — true, and
  still the right call — but the sitemap *encodes* the user's `baseurl` error rather
  than protecting from it. Pair it with `environment_url` as ground truth.
- **The permission set is unverified for deployments.** See below.

## Methodological note: the public-repo false pass, again

The PAT reads `/deployments` fine (200) — but so does an **unauthenticated** request,
because the repo is public. `/actions/runs` too. **The PAT's success proves nothing
about whether the design's permission set is sufficient**; it only proves the repo is
public. This is exactly the trap #7 documented, and it nearly produced a wrong
conclusion here ("permissions are fine ✓").

Consequence: whether a **private** site repo needs `deployments: read` — which the
design does not request — is **unknown**. It does not block the MVP (Pages' free tier
requires public), but the design must not claim the permission list is verified.

Corollary: for a public site the entire finish line could be polled *unauthenticated*.
Use the token anyway — 5,000 req/hr authenticated vs 60 unauthenticated.

## Run it

```
TOKEN_FILE=/path/to/token REPO=owner/scratch node setup.js   # once, idempotent
TOKEN_FILE=/path/to/token REPO=owner/scratch node run.js
```

`setup.js` makes the scratch repo a *correct* Jekyll project site (derives
`url`/`baseurl` from the Pages API, adds `jekyll-sitemap` and an `index.md`) so
`run.js` measures the happy path. `run.js` publishes a uniquely-named post each
time and leaves it there — the repo accumulates posts; `git-data-move`'s `run.js`
resets it.
