# ADR-0014: Deployments API for success, the `build` check-run for failure

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #4 (success path), #9 (failure path)
- **Code:** `src/finishline/`
- **Related:** ADR-0013 (live URL), ADR-0015 (Undo)

## Context

After a publish commit, the app polls until it can say what happened. Two candidate signals exist: the Deployments API and `/actions/runs`.

Phase 1 tracked success via Deployments and assumed failure would arrive the same way. It does not.

## Decision

- **Success:** `GET /deployments?sha={sha}&environment=github-pages`, then `/deployments/{id}/statuses` (`waiting → queued → in_progress → success`).
- **Failure:** the **`build` check-run** — `GET /commits/{sha}/check-runs`, `conclusion: failure`.
- **"No Pages configured":** `GET /repos/{owner}/{repo}/pages` → 404, checked **before** polling anything.
- **Translation is log-derived and attribution-gated.** On failure only, fetch the raw job log (one plaintext fetch) and regex `Liquid Exception: … in <file>`. Blame the post **only when that file is the one just published.**

## Evidence

### Why Deployments for success

**`environment=github-pages` is stable across both build types**, so there is one code path instead of two. The Actions route cannot manage that: a branch-based deploy's run is *synthetic* (`event: dynamic`, `path: dynamic/pages/pages-build-deployment` — not a real file in `.github/workflows/`), while an Actions-source sha may carry several runs and "which one is the Pages build?" has no reliable answer.

Verified branch-based (`prototype/finish-line/`). **Not yet verified on an Actions-source repo** — the reasoning is sound, the measurement is missing.

### Why the check-run for failure (#9, measured against a real broken build)

**The Deployments API cannot report a failure.** A failed Pages build never deploys, so `environment=github-pages` has no status to fail, and `pages/builds/latest` sticks at `building` indefinitely — observed 12+ min, with `error.message: null` throughout.

Phase-1 code that waited for a deployment status therefore yielded **`timeout`, not `build-failed`** — a live bug, invisible only because #4 never made a build go red.

The `build` check-run reports `conclusion: failure` in ~1 min. Even a branch-based ("legacy") site builds through the Actions "pages build and deployment" pipeline, so this one signal covers both build types; the split feared earlier is smaller than it looked.

### Why the raw log, not the annotation

The check-run **annotation truncates at 4096 chars** and Jekyll's debug log fills that before the error. The raw job log carries `Liquid Exception: … in <file>` — naming the error, the line, and the file.

Live-verified end to end: a real red build produced *"'if' tag was never closed (line 2) in your post"*, correctly attributed.

## Consequences

- **Attribution gating is the point.** A cause in a theme or plugin, or no parseable cause, both fall to the honest floor: "the build failed, here's the link." A wrong line number sends a git-averse writer hunting for a mistake they did not make — worse than no line number.
- **The error vocabulary targets body Liquid, not front matter.** The original design example — a stray quote in front matter — is **unreachable**: ADR-0010's CST writer cannot emit broken YAML. The reachable red build is body Liquid, and `{% raw %}` is the fix to suggest.
- Failure detection costs nothing in the common case: the log fetch happens only on failure.
- The Actions-source measurement gap is the one open item on this decision.
