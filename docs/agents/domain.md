# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**This repo is single-context.**

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

`docs/adr/` exists and holds ADR-0001 through ADR-0021, extracted from `docs/DESIGN.md`'s decision log in July 2026. Start at `docs/adr/README.md` — it indexes all of them and gives a reading order. `CONTEXT.md` does not exist yet; that is expected, not a gap to fix.

`docs/DESIGN.md` is now the **product** document: thesis, constraints, system shape, accepted limits, and a pointer table into `docs/adr/`. Read it for what the project is and why it exists. It is not a domain glossary and is not maintained by `/domain-modeling`; where the two eventually overlap, `CONTEXT.md` owns the vocabulary. It no longer holds a decision log — an ADR is the authority on any decision.

PRDs for unbuilt work live as GitHub issues labelled `prd` (see `issue-tracker.md`), and `docs/DESIGN.md` links them from its "Deferred and out of scope" table.

## File structure

```
/
├── CONTEXT.md              (not yet created)
├── docs/
│   ├── DESIGN.md           product thesis + pointers
│   └── adr/
│       ├── README.md       index and reading order
│       ├── 0001-git-data-api-for-writes.md
│       └── … through 0021
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
