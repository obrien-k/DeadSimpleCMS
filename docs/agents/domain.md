# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**This repo is single-context.**

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

Neither exists yet — that is expected, not a gap to fix.

Note that `docs/DESIGN.md` is **not** one of these files: it is the product design and its decision log, written for humans, and it predates this setup. Read it for background on what the project is and why it rejected a Decap fork; it is not a domain glossary and is not maintained by `/domain-modeling`. Where the two eventually overlap, `CONTEXT.md` owns the vocabulary.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-git-data-api-for-writes.md
│   └── 0002-yaml-cst-for-front-matter.md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
