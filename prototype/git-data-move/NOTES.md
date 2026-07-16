# Prototype: Git Data API atomic move

**Status: answered. Delete this directory once the findings land in the real code.**

## Question

Can a fine-grained PAT with `contents: write` perform an atomic `_drafts` →
`_posts` move in one commit via the Git Data API — and does compare-and-swap
actually protect against concurrent edits?

## Verdict: yes on every count, with two corrections to the design

Run against `obrien-k/deadsimplecms-scratch` (private, disposable) with a real
fine-grained PAT created from the template URL in DESIGN.md's auth section.

**1. The fine-grained PAT reaches the Git Data endpoints.** This was the open
question the design rested on and it's now closed: `contents: write` covers
`git/blobs`, `git/trees`, `git/commits`, and `git/refs` — no separate
permission, no 403. The permission set in DESIGN.md is correct as written.

**2. The move is genuinely atomic — GitHub itself confirms it.** Expressing the
move as a tree delta over `base_tree` (new path added, old path tombstoned with
`sha: null`) produces one commit, and GitHub's API reports it as a single
`renamed` file with `previous_filename` set, not as an add plus a delete.
**Rename detection only fires within a single commit**, so the API reporting a
rename is direct evidence there was never an intermediate state where the site
had two copies of the post. That was the exact failure mode the Contents API
route couldn't rule out.

**3. Unicode survives.** `TextEncoder` → base64 → GitHub → base64 →
`TextDecoder` round-trips 🎉 and café intact, confirming the DESIGN.md note.
(The naive `atob`/`btoa` path was never tried — it's documented as broken and
this prototype doesn't relitigate it.)

**4. Image + post land in one commit → one Pages build.** Two blobs, one tree,
one commit. Confirms the multi-file rationale for choosing Git Data.

**5. Conflict protection is stronger than the design assumed — two independent
layers.**

- *Client-side*: re-read HEAD before writing, compare to the sha read at open
  time, refuse if it moved. Catches the conflict before any write happens.
- *Server-side*: `PATCH git/refs` with `force: false` **rejects a
  non-fast-forward update with `422 Update is not a fast forward`.** This is the
  real guarantee — even if the client-side check is buggy or racy, the server
  will not let a stale-parented commit clobber HEAD.

The design described CAS on the blob sha (Contents-API thinking). The Git Data
equivalent is the ref update, and it's free: **never pass `force: true`.** That
one flag is the whole safety property.

## Corrections for DESIGN.md

- **"~4 API calls per save" is wrong — it's 6**: `getRef`, `getCommit`,
  `createBlob`, `createTree`, `createCommit`, `updateRef`. In the real app 2 are
  avoidable by caching the head commit's tree sha from the initial load, so ~4
  is achievable but is not what a naive implementation costs.
- The CAS description should name the ref update (and `force: false`) rather
  than the blob sha.

## What to keep

- `api.js` is close to what the real client needs: plain `fetch`, no Octokit
  (which would blow the bundle budget), correct unicode handling, `atomicMove`
  taking `expectedHeadSha`.
- The `force: false` rule deserves to be a load-bearing comment in the real
  code, not folk knowledge — it is the only thing preventing silent clobbering.

## Run it

```
TOKEN_FILE=/path/to/token REPO=owner/scratch-repo node run.js
```

Idempotent: resets the scratch repo to seed state before each run. Needs a
fine-grained PAT with `contents: write` on the target repo.
