# ADR-0021: TypeScript + Preact, and a textarea editor with live preview

- **Status:** Accepted
- **Date:** July 2026
- **Code:** `src/`, `src/app/views/Editor.tsx`
- **Related:** ADR-0002 (~30 kB of the budget), ADR-0018 (vendored, so the budget binds)

## Context

The product constraint is "incredibly minimal": one static admin page, **hard budget ~100 kB gzipped total**, enforced in CI. ADR-0018 vendors the bundle into the owner's repo, so every kilobyte is committed to someone else's git history — the budget is binding, not advisory.

## Decision

**TypeScript + Preact** (~4 kB runtime). No React.

**Editor: a markdown `<textarea>` + live side preview** (micromark or marked) + a minimal toolbar — bold, link, image, heading. No block editor, no WYSIWYG framework.

## Rationale

- Preact gives JSX ergonomics for ~4 kB and fits the budget. React's runtime does not.
- **Block editors are where CMS bundles go to bloat** — and ADR-0003 identified exactly that weight as a disqualifying reason not to fork Decap. Shipping it anyway would forfeit the differentiator.
- A textarea round-trips the body byte-for-byte, which the front-matter invariant (ADR-0002) demands of the whole file.

## Budget accounting

| Component | gzipped |
|---|---|
| `yaml` (CST, does not tree-shake — ADR-0002) | ~30 kB |
| Preact | ~4 kB |
| Markdown renderer | ~13 kB |
| **Subtotal** | **~47 kB** |
| Remaining for app code | ~50 kB |

If it tightens, the first move is code-splitting the front-matter patcher behind the editor route — the post list does not need it.

## Consequences

- **The preview can lie about Liquid.** `marked` renders `{% include %}` as literal text, so a page whose body is Liquid previews wrong. Handled by warning on `{%` / `{{` rather than by adopting a Liquid-aware renderer (ADR-0008). The textarea itself is safe.
- No i18n, no media library, no widget system. Deliberately ceded to Decap and Sveltia (ADR-0003).
- The budget is enforced in CI. Measuring it requires a fresh build first — a stale `dist` reports a fictional number.
