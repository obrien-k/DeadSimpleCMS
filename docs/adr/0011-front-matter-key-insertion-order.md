# ADR-0011: Insert new front-matter keys in form order, ranked by file position

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #6
- **Code:** `src/frontmatter/`
- **Related:** ADR-0002 (no CST path for adding keys), ADR-0012 (inferred extras)

## Context

ADR-0002 establishes that `CST.setScalarValue` only edits existing scalars, so **adding a key requires a text insertion**. This is phase-1 work, not an inference concern: a user typing a `description` into a post that lacks one is inserting a key, in the core loop.

Where the new key lands is a real decision, because YAML comments have no owner. Inserting above a `# Taxonomy below` comment and inserting below it produce different meanings for a human reader.

## Decision

**Form order, ranked by file position.**

Insert after the last present key that *precedes* the new one in the form's field order. Fall back to the end of the block when no predecessor is present. **Existing keys never move.**

The form's field order is `title → date → description → tags → categories → image`. It is not cosmetic — it is this rule's input.

**Rank by file position, never form position.** A file may order `categories` before `tags` while the form does the reverse; trusting form position inserts into the wrong place.

## Rationale

- The form's fixed field order beats a sampled corpus, and works **before inference exists** — inference is phase 2 (ADR-0012), insertion is phase 1.
- **This dissolves the comment-adoption problem rather than special-casing it.** A new `description` lands after `date` and *above* a `# Taxonomy below` comment, which goes on labelling the taxonomy.

## Consequences

- **Residual, unavoidable:** a key last in form order with no successor present still lands at the end, where a trailing comment can adopt it. YAML comments have no owner — whether `# Taxonomy below` heads `tags` or trails `date` is undecidable. The rule minimises damage; it is not correct, because correct is not available.
- **Form order and file order disagree for inferred extras.** A key outside `FORM_ORDER` gets `rank === -1`, so it inserts *after the last key in the file*: an inferred `author` shows seventh in the form and lands at the bottom of the front matter. Harmless — Jekyll does not care about key order — and the fix would mean threading a per-site order through `src/frontmatter/`'s public API, a large change to the one module the design says to keep small.
- **Nested keys are a block, not a line**, and the design's own example is one: `image.path` where `image` is absent, with cover image sitting in the phase-1 form. `stringify({image: {...}})` emits it, but the **indent must be detected from the file** — stringify's default of 2 bolts a foreign-looking block into a 4-indented file.
- An inferred field left blank never triggers this rule: `diffEdits` emits an edit only when the value changed, and `create` skips empties on the new-post path.
