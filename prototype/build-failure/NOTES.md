# Prototype: what a red Pages build actually reports (#9)

**Status: answered AND built.** The detection fix + attribution-gated
translation landed in `src/finishline/`, `src/gh/`, and `src/app/messages.ts`;
`verify-track.mts` drives the real `trackPublish` through a live red build.
Revert (the ticket's other half) is a separate follow-up increment.

Run by hand against `obrien-k/DeadSimpleCMS-scratch`
(public, `build_type: legacy`, branch `main`, custom domain). `observe.mts`
breaks the build with reachable bad Liquid, then reads every candidate signal.

## The question

The design promises failed builds are "translated to human terms" — *"your
post's front matter has a stray quote on line 3."* Nobody had watched a real
red build. #9 asks: what signal is actually available, is it attributable, and
does the stray-quote example survive?

## Verdict: the example is half-right, but every premise about WHERE the signal
lives was wrong. One shipped assumption in `src/finishline` is a live bug.

Broke the build with an unclosed `{% if x %}` in a post body — pure CMS use, no
git (the app never touches body Liquid). What each endpoint reported:

### 1. `pages/builds/latest` is a dead end on failure — the ticket's premise is false

#9 expected this endpoint's `error.message` to carry the failure. It does not.
On a failing build it **sticks at `status: "building"`, `error.message: null`,
`duration: 0` for 12+ minutes** (never observed to resolve). The green build
sets `error.message: null` too, so the field is inert in both states. This
endpoint cannot detect failure, let alone explain it.

### 2. The Deployments API reports failure by ABSENCE — and that breaks shipped code

`GET /deployments?sha=&environment=github-pages` returns **zero deployments**
for a failed sha. A failed build never deploys (the `deploy` job is *skipped*),
so no `github-pages` deployment is ever created, and there are no statuses to
poll.

**`src/finishline/trackPublish` assumes the opposite.** It waits for a
deployment, then polls its statuses for a `TERMINAL_FAILURE` state
(`error`/`failure`/`inactive`) to yield `build-failed`. On a real failure that
deployment never appears, so the loop exhausts `maxDeploymentPolls` and yields
**`timeout`, not `build-failed`** — the user is told "GitHub has not reported
anything for a while" when the build definitively failed. This is the bug #9
must fix, and it was invisible because #4 never made a build fail.

### 3. The real failure signal is the Actions run / check-runs — one JSON call

Even a `build_type: legacy` (branch-based) site now builds through the Actions
"pages build and deployment" pipeline. The clean, compact signal:

```
GET /commits/{sha}/check-runs
  build              → conclusion: failure
  deploy             → conclusion: skipped
  report-build-status→ conclusion: success
```

`build.conclusion === 'failure'` is the honest, fast (~1 min) red-build
detector. So the **build-type split #9 feared is smaller than expected**: both
build types surface here. (Whether an Actions-*source* site — user-authored
workflow — also populates check-runs the same way is untested; this was a
branch-based site whose build GitHub runs via Actions.)

### 4. Translation is achievable — but only from the raw job log, not the annotation

The failed `build` check-run has one `failure`-level **annotation**, but it is
**truncated at 4096 chars** and its location is anchored to `.github` line 53
(the workflow), not the post. Jekyll's verbose debug log fills those 4096 chars
before reaching the error — with only ~14 posts the fatal line had already
scrolled off. **The annotation is not a reliable error source.**

The raw job log (`GET /actions/jobs/{id}/logs`, one redirect → **27.9 kB
plaintext**) carries the exact error:

```
Liquid Exception: Liquid syntax error (line 2): 'if' tag was never closed
  in /github/workspace/_posts/2026-07-17-break9.md
```

This names the **error, the line, and the exact file the user just published** —
so the design's aspiration is reachable for this class of error, by regexing
the log tail, at a runtime cost of ~28 kB fetched (not bundle budget; the
download is at publish time). The line number is relative to the file.

### 5. Attribution is clean when the named file is the user's post

The log names `_posts/2026-07-17-break9.md` — the post just committed. That is
the evidence that justifies blaming this commit. When the error names a theme
or plugin file instead (a break the user did not cause), the honest UI is #4's
floor: say the build failed, link it, do not blame their post. The rule is
**"attribute only when the error names the file we just wrote."**

## What was built (detection + translation) — DONE and live-verified

- **`src/finishline` fixed**: `trackPublish` now detects failure from the build
  check-run's `conclusion: failure` (via `gh.getBuildState`), not by waiting for
  a deployment that never comes. The `build-failed` event fires correctly. The
  deployment is now used only for the site URL on the success path.
- **`src/gh` added** `getBuildState` (check-run outcome) and `getBuildLog`
  (runs → jobs → 302 plaintext, only fetched on failure).
- **Translation is attribution-gated**: on failure, `parseBuildFailure` regexes
  the Jekyll `Liquid Exception … in <file>` out of the raw log (seeing through
  ANSI + timestamps), and the message only blames the post when the named file
  is the one just published (`cause.mine`). Otherwise → the honest floor.
- **`src/app/messages.ts`** has three build-failed sentences: attributed,
  someone-else's-file, and no-cause floor.
- **Live-verified** end to end (`verify-track.mts`): the real `trackPublish`
  against a real red build yielded
  `build-failed { file: _posts/…/verify9.md, line: 2, "'if' tag was never
  closed", mine: true }` — the design's aspiration, reached for the reachable
  class.
- **Design correction (for the map/DESIGN.md)**: the stray-quote-in-front-matter
  example is **unreachable** — `src/frontmatter/`'s CST writer can't emit broken
  YAML. The reachable red build is **body Liquid**, fixed with `{% raw %}`. The
  vocabulary targets that, not a YAML quote.

## Still to do — a separate increment

- **Revert (the ticket's other half).** Measured here: reverting the break
  (deleting the post) returns the build to green in ~40s, so revert gets its own
  finish line and should reuse `trackPublish` on the revert commit. Open design
  Qs from the ticket remain: revert the *file* or the *commit* (they diverge once
  an image landed in the same commit); what if the build was already red before
  this commit; and restoring the *draft* rather than just deleting the post so
  the writer does not lose their work. Deserves its own focused pass.
- **`yaml-broken` control run** (out-of-band front-matter break) — low value,
  since the CMS cannot produce it; the finding already stands.

## Notes

- A failing build does NOT take the site down: Pages keeps serving the last good
  build throughout. "Your previous posts are unaffected" is literally true.
- `pages/builds/latest` being stuck at `building` is why the first observe run
  looked like a 12-minute hang — the Actions build had already failed in ~1 min;
  only the legacy endpoint lied.
