# ADR-0015: Undo reverses the publish move — it is not `git revert`

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #9 (Undo), #16 (unpublish and delete)
- **Code:** `src/finishline/`, `src/app/views/Unpublish.tsx`
- **Related:** ADR-0001 (atomic moves), ADR-0014 (attribution)

## Context

When a publish breaks the build, the writer needs an escape hatch. `git revert` is the git-native answer and the wrong one: it speaks git, and it throws away work.

Separately, #16 asked for the two ordinary draft operations — unpublish a post, delete a draft — which turn out to be the same machinery.

## Decision

**Undo is unpublish.** The publish is one move commit (`_drafts/x.md` → `_posts/DATE-x.md`, plus any images); Undo reverses exactly that — recreate the draft with the post's content, delete the post — so the writer keeps their work and can fix it.

**Undo is offered only when the failure was attributed to this post** (ADR-0014). When the break is elsewhere, removing the post cannot turn the site green, so the copy points to GitHub instead.

**Unpublish (#16) is the same operation, user-initiated**: `_posts/DATE-x.md` → `_drafts/x.md`, reusing `buildUnpublish` + `trackRevert`.

**Deleting a draft is one tombstone commit** (`sha: null`) with **no finish line** — drafts do not build, so there is nothing to track.

**Both destructive actions arm through an inline two-step confirm**, worded to distinguish a delete's finality from an unpublish's reversibility.

## Rationale

- **Image blobs that rode the publish are deliberately kept.** The restored draft still references them; a git-commit revert would strip them.
- **The front-matter date rides along untouched.** The filename's date is dropped, but the front-matter date is the source of truth (ADR-0009's listing reads it), so republishing re-derives the identical name — a 2019 post, unpublished and republished, stays 2019. No silent date drift.
- **Undo gets its own finish line**: the same `build` check-run watched again, reporting *reverted* when the site goes green. If it is still red, it says honestly that the break pre-dated this post — which is now gone, so it is never blamed.
- **Unpublish gets a finish line too**, watching the site rebuild *without* the post, and naming the ~10-minute Pages cache (ADR-0013) so the writer who reloads and still sees the page is not misled.
- **Inline confirms, not `confirm()`.** A native `confirm()` blocks the page.

## Evidence

Live-verified:

- Publish break → attributed → Undo → draft restored with content, post gone, build green (#9).
- Publish → unpublish → draft back with content → republish to the same path (#16).
- Draft created, then deleted (#16).

## Consequences

- The writer never sees git vocabulary in the recovery path, and never loses the post body.
- Orphaned image blobs accumulate if a post is published, undone, and abandoned. Accepted: the alternative strips images from a draft that still links them.
