# ADR-0001: Git Data API for writes, not the Contents API

- **Status:** Accepted
- **Date:** July 2026
- **Code:** `src/gh/`

## Context

Every write this app performs is a commit to the owner's repo via the GitHub REST API. Two API surfaces can commit: the Contents API (one call per file) and the Git Data API (create blob → create tree → create commit → update ref).

The core operations are not single-file edits:

- **Publish is a move**: `_drafts/x.md` → `_posts/YYYY-MM-DD-x.md`.
- **Insert-image-and-save is two files**: the post body and the uploaded image.

The Contents API is one-file-per-commit and has no move operation. Publish via Contents is a create plus a delete — two commits, non-atomic. A failed delete leaves a duplicate post live on the site, which is a user-visible corruption of the thing the project exists to get right.

## Decision

All writes go through the Git Data API. The Contents API is used only for reading a single file when opening the editor (see ADR-0009 for why listing never touches it).

Never pass `force: true` to `PATCH git/refs`. See ADR-0016 — that flag is the entire server-side concurrency guarantee.

## Evidence

Prototype-verified July 2026 against a scratch repo with a real fine-grained PAT:

- `contents: write` reaches every Git Data endpoint. No separate permission, no 403.
- The move is atomic, and GitHub proves it: the API reports the commit as a single `renamed` file with `previous_filename` set, rather than an add plus a delete. Rename detection fires only *within* one commit, so this is direct evidence that no intermediate two-copies state existed.
- Image + post in one commit produces one build.
- Unicode round-trips intact via `TextEncoder`.

## Consequences

- **Cost: 6 API calls per save** (`getRef`, `getCommit`, `createBlob`, `createTree`, `createCommit`, `updateRef`) against one for Contents. Two are avoidable by caching the head commit's tree sha from the initial load, bringing it to ~4.
- Atomicity is worth that cost: one commit means one build, and no window in which the site is wrong.
- Content is base64 on the wire in both directions. Encode and decode via `TextEncoder`/`TextDecoder`, never bare `atob`/`btoa` — those mangle non-ASCII, so a single emoji in a post corrupts the file silently, and only for some users.
- The ~100 MB per-file write ceiling applies here. Irrelevant for blog media.
