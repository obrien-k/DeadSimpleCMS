# Prototype: token scope detection

**Status: answered — negative result. Delete this directory once the findings land
in DESIGN.md and #7.**

## Question

`docs/DESIGN.md` promises a token scoped wider than one repo is "detected on first
use and warned about, not silently accepted." What check makes that true?

#7's comment proposed two candidates: the `permissions` field on the repo response,
or a deliberate write probe.

## Verdict: no such check exists. The promise cannot be kept.

**Over-scope is not detectable client-side.** Both proposed candidates fail, and so
does the one candidate that looked like it would work. `DESIGN.md`'s "verify it"
promise must be struck, not reworded.

The premise underneath #7 is false: a token scoped to *all* repos and a token scoped
to *only the target* are **indistinguishable when you probe the target**. Every
proposed check measures the token's power *over the target* — the one dimension
where over-scoping does not show up. Breadth is only observable by proving the token
**cannot** reach something *else* — and the app cannot find that something else.

## The shape of the failure: discovery, not the probe

The two halves, measured separately:

- **The direct probe WORKS.** Token A (scoped to one repo) against a private repo of
  the same account → **404**. Scoping is real and a direct `GET` sees it.
- **Discovery is IMPOSSIBLE.** A fine-grained PAT cannot enumerate private repos, so
  the app can never obtain a repo name to point that working probe at.

A check whose probe works but whose target is undiscoverable is not a check.

## Findings

Token A = fine-grained PAT scoped to one repo (`obrien-k/deadsimplecms-scratch`, public).
Token B = fine-grained PAT on a **different account**, scoped to a **private** repo it owns.

**1. `permissions` is not a scope oracle — it reports the USER's role. CONFIRMED.**

Byte-identical across both tokens — different accounts, different repos, one public
and one private:

```
token A: {"admin":true,"maintain":true,"push":true,"triage":true,"pull":true}
token B: {"admin":true,"maintain":true,"push":true,"triage":true,"pull":true}
```

`admin` / `maintain` / `triage` are **not fine-grained PAT permissions** — they are
repository *role* names. The field answers "what is this user's role on this repo",
not "what did this token grant". **This kills the answer #7's comment proposed.**

**2. `/user/repos` NEVER lists private repos for a fine-grained PAT — regardless of scope.**

The decisive measurement is token B: its target **is private**, and the token
**reached it** (`GET /repos/{target}` → 200) — yet:

```
targetPrivate: true, privateVisible: 0
```

**A private repo the token demonstrably can read did not appear in its own private
listing.** Corroborated by token A: 0 private visible, while the account actually has
13 (per `gh` with the user's own credentials). `visibility=all` and
`visibility=private` both return 0 private across every affiliation.

The endpoint returns the user's **public** repos only. This is what makes the canary
undiscoverable, and it is the whole negative result.

**3. This corrects #2.** #2's resolution says `/user/repos` "ignores the token's repo
scoping entirely." That is true for *public* repos but wrong as stated: private repos
are not "ignored", they are **absent**. #2 drew the right conclusion (don't use it to
enumerate scope) from a mechanism that is slightly different than described — and the
difference matters, because "ignores scoping" implies the data is there but unfiltered,
which is what made the canary idea look viable.

**4. A public repo can never be a detector.** Unauthenticated `curl` to
`/repos/obrien-k/deadsimplecms-scratch` → **200**. Public repos answer *any* caller,
token or none. A Jekyll site on Pages is usually public — the exact false pass #7 flagged.

**5. Expiry is free, on every response — no dedicated call.**

```
github-authentication-token-expiration: 2026-07-23 05:00:00 UTC   (token A)
github-authentication-token-expiration: 2026-07-19 05:00:00 UTC   (token B)
```

Lets the app warn *before* the 401 instead of reacting to it, and means expiry never
has to be guessed from the template URL's `expires_in` — the token reports its own.

*(Both tokens here expired in ~7 days rather than the template URL's 366. That says
**nothing** about real users: both were hand-made for this test with a short expiry
deliberately chosen, at my request. Noted only so a later reader does not mistake the
sample for a finding.)*

**6. `x-accepted-github-permissions` is a decoy.** Present on every response
(`metadata=read`), but it describes what the *endpoint requires*, not what the *token
holds*. Identical regardless of scope.

**7. Token prefix is the ONLY over-scope check that works — and it is free and offline.**
`ghp_` (classic) is all-repositories **by construction**: over-scope proven with zero
API calls. `github_pat_` (fine-grained) reveals nothing about breadth. This catches
the likeliest real-world over-scope — someone pastes an old classic token — for free.

## What the app can actually do

| Failure mode | Detectable? | How |
|---|---|---|
| Classic token (all-repos by construction) | **yes**, free | prefix `ghp_` — offline, zero calls |
| Fine-grained token scoped too widely | **NO** | nothing works. Install-time UI carries it |
| Token expired / expiring | **yes**, free | `github-authentication-token-expiration` header |
| Wrong repo / not scoped / missing write | **yes**, 1 call | dangling-blob write probe (see below) |

The **dangling-blob probe** collapses three failure modes into one honest check:
`POST git/blobs` → `201` proves the token can really write here; `404`/`403` proves it
cannot. Already verified: `contents: write` reaches `git/blobs`
(`prototype/git-data-move`), and an unscoped repo returns 404 on it (#7's comment).
The created blob is unreferenced by any tree and gets garbage-collected — a genuinely
harmless write. It is the only check that tests the thing that actually matters: *can
this token publish to this repo?*

Note it deliberately does **not** distinguish "wrong repo" from "not scoped" from
"missing permission" — GitHub 404s all three on purpose, to avoid leaking whether a
private repo exists. Do not fabricate a distinction the API refuses to make; say all
three in one message.

## Consequence for DESIGN.md

`DESIGN.md:79` — "*a token scoped wider than one repo should be detected on first use
and warned about, not silently accepted*" — **is unimplementable. Strike it.** The
sentence before it survives and now carries the entire guarantee: the UI must call out
"choose **only** {repo} under Repository access", because that dropdown is the *only*
enforcement point that exists. Nothing downstream can audit it.

## Run it

```
TOKEN_FILE=/path/to/token TARGET=owner/repo node probe.js
```

Read-only — every call is a GET, nothing is written, the token is never printed (only
its kind and length). Run against two tokens and diff the `SUMMARY` lines.

## Notes for whoever re-runs this

- `prototype/git-data-move/NOTES.md` calls `obrien-k/deadsimplecms-scratch` "private,
  disposable". **It is PUBLIC as of 2026-07-16.** Every finding here turns on
  public-vs-private, so check visibility before trusting a re-run.
- GitHub served 503 "Unicorn!" pages on *authenticated* requests for part of
  2026-07-16 while unauthenticated reads stayed fine. If section 3 dies on a 503, it is
  not this probe.
- **Not measured:** a genuine *All repositories* token. It was not needed — the
  conclusion rests on discovery being impossible, which token B settled. An all-repos
  token could only be observed *through* an oracle that provably does not work.
