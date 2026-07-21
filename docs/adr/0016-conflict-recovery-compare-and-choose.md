# ADR-0016: Concurrency — `force: false` server-side, compare-and-choose client-side

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #15
- **Code:** `src/app/diff.ts`, `src/app/views/Conflict.tsx`, `src/gh/`
- **Related:** ADR-0001 (Git Data writes)

## Context

Two editors (or one editor in two tabs, or an editor plus a hand-edit on GitHub) can move HEAD between the moment a file is opened and the moment it is saved.

Phase 1 detected this and then stranded the user: "this changed on GitHub", edit stuck in the textarea, only exit copy-paste-and-reload — the by-hand git step the project exists to prevent.

## Decision

**Two independent guards. The server-side one is the real guarantee.**

**Server-side:** `PATCH git/refs` with **`force: false`** rejects a non-fast-forward update with `422 Update is not a fast forward`. Even a buggy or racy client cannot clobber HEAD with a stale-parented commit.

> **Never pass `force: true`.** That single flag is the entire safety property. It is the Git Data equivalent of the blob-sha compare-and-swap, and it is free.

**Client-side:** re-read HEAD before writing and compare against the sha read at open time; refuse if it moved, before any write happens.

**The refusal opens a side-by-side compare** — your version beside the one now on GitHub, with the differing lines shaded — and asks for one decision:

- **keep mine** — re-commit, re-parented on the fresh head (re-opening if HEAD moved again)
- **use theirs** — load their version
- **save mine as a copy** — the escape that loses nothing

No git vocabulary, no merge UI. The writer sees what changed and chooses.

## Evidence

The prototype tried three recovery shapes (#15):

| Shape | Verdict |
|---|---|
| Escape-only (copy out, reload) | Rejected — that is the dead end being fixed |
| **Compare-and-choose** | **Won** |
| Line-by-line merge | Rejected |

**Compare-and-choose won because seeing *what* changed is what lets a non-technical writer decide**, and the conflict is genuinely two-sided — in the prototype, the title moved on GitHub while a body line moved locally, so a blind keep-mine would silently drop the other person's fix.

**Line-by-line merge was rejected as peak complexity and budget** for a path first run by someone who has already lost work.

`diffLines` (LCS, whole-file) shades the differing lines. Live-verified end to end.

## Consequences

- **Wired on Save only.** A Publish-time conflict still shows the neutral message. That gap is known and deliberate — Publish is the rarer collision and the compare UI assumes an editor buffer to compare against.
- The client-side check is a UX affordance, not a guarantee: it narrows the race but cannot close it. `force: false` closes it.
- `diffLines` is whole-file LCS with no diff library dependency, keeping the bundle cost near zero.
