# Onboarding wizard flow — prototype (#29)

## Question

Does the signed-off installer step sequence feel right when actually walked, and
do the four #8 collision screens plus the preflight blocks read correctly to a
non-technical site owner?

## What it is

A throwaway clickable HTML (`index.html`) that walks the six steps —
Landing → Repo → Token → Preflight → Install → Live. Network is faked; the
scenario bar at the bottom seeds what GitHub would answer so every branch is
reachable without a live repo. User-facing copy is lifted verbatim from
`src/app/messages.ts` and `src/app/token.ts` so we react to the real voice, not
placeholder text.

Run: open `index.html` in a browser, or `python3 -m http.server` in this dir.

Scenarios (← / → in the bar, or arrow keys): happy path, token-expiry warning,
repo unreachable, no Pages, HTTPS off, and the five #8 collision outcomes
(ours / ours-different-repo / decap / unknown-no-overlap / unknown-index).

## Verified working (browser-driven, 2026-07-17)

- Step strip advances and marks steps done; state dump renders every step.
- Repo carries through to the token screen; the pre-filled PAT link and the
  load-bearing "Repository access" dropdown callout both render.
- Classic-token (`ghp_`) paste is refused inline with the real message; holds.
- Happy-path preflight passes all four checks incl. "admin/ is clear".
- **Decap collision**: names what it sees, names exactly what's replaced
  (`index.html`) vs left alone (`config.yml` + everything), the nothing-deleted /
  git-history reassurance, the "coming from Decap?" orientation paragraph, and
  explicit Replace-vs-Cancel consent.
- **Unknown `admin/index.html`**: refuses, no overwrite path, only "Start over".

## Verdict

Flow and copy **approved as walked** (2026-07-17). Two UX questions resolved:

1. **Preflight is one combined screen** that short-circuits at the first failed
   gate (reachability → HTTPS → Pages → #8 collision) — not four separate steps.
   A user who fixes one gate and hits the next sees them sequentially; accepted.
2. **Collision consent copy stays blunt** — "Replace admin/index.html and
   install →". The scary word is doing honest work; keep it.

Remaining: the real `src/` installer build (its own slice — new surface, a Pages
deploy of the project repo, an installer bundle reusing the gh client). Fold
these decisions in there, then delete this prototype.
