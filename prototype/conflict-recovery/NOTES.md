# Prototype: what the user does after "this post changed since you opened it" (#15)

**Status: answered AND built.** UI prototype (three variants, sub-shape A). The
variant scaffolding has been deleted; the chosen answer is folded into
`src/app/views/Editor.tsx` + `Conflict.tsx` + `diff.ts`. `verify-conflict.mts`
(kept) drives the real conflict path against the scratch rig.

## The question

Detection already worked — the client re-reads HEAD, the server rejects a
stale-parented commit with `force: false`, the editor caught it and showed
`MSG.conflict`. And then *nothing*: the writer was told "no", their edit stuck
in the textarea, the only way forward copy-paste-reload — the "go do a git thing
by hand" failure this project exists to prevent. **What should happen instead?**

## The three variants (flipped through, then thrown away)

- **A — Nothing is lost (save a copy).** One button that saves your version as a
  separate draft, no compare. The honest floor.
- **B — Compare and choose.** ✅ **CHOSEN.** Side-by-side "Your version | Now on
  GitHub" with the differing lines shaded, then a binary keep-mine / use-theirs —
  plus "save mine as a copy" as the door that loses nothing.
- **C — Resolve line by line.** Per-line use-mine/use-theirs toggles; closest to a
  real merge, and the most code/most to test for a path that ~never fires.

## Verdict: B, with A's "save a copy" kept as the escape door

B was chosen because seeing *what* changed is what lets a non-technical writer
decide without git vocabulary, and the conflict here is genuinely two-sided (the
title moved on GitHub while a body line moved locally) — a blind "keep mine"
would silently discard the other person's fix. C's per-line merge was rejected:
peak complexity and budget for something first exercised by someone who has
already lost work and has never tested it. A's escape ("save mine as a copy")
survives inside B as the no-decision door, so nothing is ever forced or lost.

## What was built

- `src/app/diff.ts` — `diffLines`, an LCS line diff marking which lines to shade
  per side (whole-file, so front matter and body compare alike). Unit-tested.
- `src/app/views/Conflict.tsx` — the side-by-side compare + three actions.
- `src/app/views/Editor.tsx` — the Save path now catches the conflict, fetches
  the current GitHub version, and shows the compare; keep-mine re-commits
  re-parented on the fresh head (re-opening the compare if HEAD moved again),
  use-theirs loads their version, save-a-copy writes a new draft.
- `MSG.conflict` — dropped the old "reload and re-apply by hand" tail; it now
  states the facts and lets the compare offer the next step.
- **Live-verified** (`verify-conflict.mts`): a stale-parented Save is rejected
  (409), the compare fetches theirs, `diffLines` flags the differing lines,
  keep-mine lands and replaces theirs, save-a-copy writes a new draft untouched.

## Not built (deliberate scope)

Conflict recovery is wired on **Save** — the dead end the ticket describes
("their edit is still in the textarea"). A Publish-time conflict (rarer: it needs
someone else editing *your* draft) still shows the neutral `MSG.conflict`; giving
it the compare too would mean replaying the draft→post move and is a separate,
smaller follow-up.
