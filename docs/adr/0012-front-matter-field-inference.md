# ADR-0012: Infer form fields from the 20 most recent posts — no schema file, ever

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #13
- **Code:** `src/infer/`, `src/app/views/Editor.tsx`
- **Related:** ADR-0008 (page creation deferred), ADR-0009 (the cache), ADR-0011 (where keys land)

## Context

"Zero config" means no schema file, ever. But the editor form has to show *something*, and a site whose posts all carry `image.path` should get that field in the form. Where does the field list come from?

## Decision

The form is **the fixed six (posts only) ∪ the file's own keys ∪ the inferred keys** — a pure function of the file plus the corpus, with no dependence on how the user arrived at the file. `buildFields` is the whole rule.

The fixed six are `title, date, description, tags, categories, image` (ADR-0011's order).

Seven sub-rules:

1. **A page's form is its own front matter, reflected back** — no six, no inference.
2. **Inference applies to every post form**, not just new posts.
3. **The corpus is the 20 most recent posts.**
4. **The threshold is a strict majority of that window.**
5. **Fields are leaf scalars, addressed by dotted path.**
6. **Under a six key, the file wins outright.**
7. **`list` wins any shape disagreement** across the window.

Extras are **labelled with their raw key path, verbatim**; the six keep their hand-written labels.

## Rationale

**Pages get nothing.** Pages are not a corpus: `index.md` carries `layout: home`, `404.md` carries `permalink: /404.html`, and a typical site has three or four — so no threshold means anything at N=3, and sampling yields the union of unlike things. Nor do pages *ask* the question inference answers, which is *"this is a brand-new post with no front matter, what fields should it have?"* — and ADR-0008 already deferred page creation. Every page that exists has answered for itself, in the file, for free. This also retires a live defect ADR-0008 shipped: the form offered `about.md` a Date and a Categories field, which nothing on the site reads and which ADR-0011 would happily write into the file. Because the six are posts-only and inference is posts-only, the rule collapses on a page to *the form mirrors the file* — one rule, no page branch.

**Every post form, not new-posts-only.** New-posts-only is unstable: `create` omits an empty inferred field, so reopening the same file would show a *different* form and the offered field would vanish for good.

**Twenty, not all.** Conventions drift. A blog that started in 2015 with bare `title`/`date` and adopted `image.path` last year has ~10% of its posts carrying it, so an all-posts majority buries the very field this decision exists to surface. The window tracks what the author is doing *now*. Post dates are already parsed from filenames, so the window costs nothing to compute. **N=20 has no evidence behind it** — no measurement can tell us the right window — so it is one defensible number, stated here, rather than a weighting curve nobody can inspect.

**Strict majority.** *More of your recent posts have this than don't*, which the site's owner can check by hand. Any-post promotes every one-off (`mathjax`, `redirect_from`) onto every form forever; 100% dies to one outlier in a 20-post window. It is self-dampening at small N precisely because the form unions in the file's own keys — at N=1 every promoted key is already an own key, and at N=2 a key in one post is 50% and not promoted. Inference starts mattering exactly when there is enough corpus for "majority" to mean something.

**Leaf scalars by dotted path.** `leaves()` walks a parsed mapping: a scalar is a leaf (`title`), a map recurses (`image.path`, `header.teaser`), a sequence of scalars is one leaf with a CSV widget (`tags`). **No depth cap** — ADR-0008 already rejected invented limits. This dissolves the editor's hand-written `image` scalar-vs-nested special case: the file's own shape names the path, and `patch` writes back to the path it was given. `create` expands dotted paths too, or a new draft would grow a key literally named `image.path`.

**File wins under a six key.** Without that rule, a post with a scalar `image:` on an `image.path` site renders *two* cover-image fields, one of which silently writes the other's shape. Caught by a test, not by review. `image.path` is the six's default only because it is what the hardcoded form did before inference existed — either the file or the corpus overrides it.

**`list` wins shape ties.** A one-item list reads back the same as the scalar for Jekyll's `tags`-style keys; a scalar written where the site means a list silently degrades a taxonomy to one string. The asymmetry is the whole tie-break.

**Raw key labels.** The label's job is to connect the field to what the theme's docs told the owner to set. `redirect_from` is the exact string jekyll-redirect-from's README uses; "Redirect From" is a name that exists nowhere and cannot be searched for.

## Consequences

- **The cache carries the corpus.** `CacheEntry` gains `keys?: KeyShapes` — leaf path → shape — on exactly the terms `fm` was added (ADR-0009): a pure function of the same content hash, so `undefined` means "never asked" and a pre-#13 entry in the window re-reads once and self-heals. **A warm cache infers with zero requests.** The shape is stored *with* the path because writing `tags: "a, b"` where the site means a list is a silent change to what Jekyll reads. A key whose shape gets no field is never stored — promoting it would let it pass the threshold and then render nothing.
- **Two admitted warts:**
  - **Form order and file order disagree for extras** — see ADR-0011.
  - **A sequence of maps (`gallery: [{url: …}]`) gets no field.** No text widget round-trips it. The key survives untouched because `patch` only names keys in the edit set, but the owner has to edit it on GitHub — the same blind spot `MSG.pagesBlindSpot` already admits to, rather than a rendered `[object Object]` they would then save back.
- **What did not need deciding.** *"Does an inferred field left blank get written as an empty key?"* is already answered by the code: `diffEdits` emits an edit only when the value changed, so an untouched field produces nothing and ADR-0011's insertion rule never fires; `create` skips empties on the new-post path. Both paths agree, and neither needed a rule.
