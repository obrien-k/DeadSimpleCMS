# ADR-0002: The `yaml` CST API for front matter, not the AST API

- **Status:** Accepted
- **Date:** July 2026
- **Code:** `src/frontmatter/`
- **Related:** ADR-0010 (YAML typing), ADR-0011 (key insertion)

## Context

A hard product invariant: unknown front-matter keys, comments, key order, and formatting are preserved verbatim. Opening and saving a file the owner hand-edits elsewhere must never launder it.

The obvious route is the `yaml` library's AST API — `parseDocument` → `doc.setIn()` → `doc.toString()`. That is parse-and-redump by another name.

## Decision

Use the CST API: `Parser` → `Composer({keepSourceTokens})` → `CST.setScalarValue(node.srcToken, v)` → `CST.stringify(token)`.

Wrap the library once in `src/frontmatter/` and never call it directly from elsewhere. See ADR-0010 — the typing rule is per-call-site discipline with no global switch, so a single missed call site silently changes what a post says.

## Evidence

Resolved by prototype (`prototype/frontmatter-roundtrip/`, July 2026):

- The AST route keeps comments and key order but **re-renders every line**: `layout:      post` normalises to `layout: post`, folded scalars reflow onto one line, flow arrays get rewritten. `keepSourceTokens` does not prevent this — the flag preserves the tokens, but `toString()` ignores them.
- The CST route re-emits every byte the parser saw. Verified byte-identical across comments, nested maps, block/folded/literal scalars, flow arrays, anchors/aliases, odd spacing, and unicode.

## Consequences

- **Budget: ~30 kB gzipped, not the ~15 kB originally estimated, and it does not tree-shake.** CST-only saves 0.8 kB over the full library, because `Parser` + `Composer` pull in nearly everything. Still fits: ~30 + ~4 Preact + ~13 markdown ≈ 47 kB, leaving ~50 kB of the ~100 kB budget for the app. If it tightens, code-split the patcher behind the editor route — the post list does not need it.
- **Adding a new key has no CST path.** `CST.setScalarValue` only edits existing scalars, so adding a key requires a text insertion. This is phase-1 work, not an inference concern: a user typing a `description` into a post that lacks one is inserting a key, in the core loop. The insertion rule is ADR-0011.
- **Nested keys are a block, not a line.** `image.path` where `image` is absent needs `stringify({image: {...}})`, and the indent must be detected from the file — stringify's default of 2 bolts a foreign-looking block into a 4-indented file.
- The CST path has no `version` option, which is what forces ADR-0010's forced-quote rule.
