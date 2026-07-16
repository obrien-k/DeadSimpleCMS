# Prototype: front-matter round-trip safety

**Status: answered. Delete this directory once the findings land in the real code.**

## Question

Can we edit Jekyll front matter as a keyed patch that preserves unknown keys,
comments, key order, quoting, and spacing verbatim — inside a ~100 kB gzipped
budget that must also hold Preact, a markdown renderer, and the app?

## Verdict: yes, but the design doc was wrong on two counts

**1. `yaml`'s AST API launders files. Its CST API doesn't.**

The doc said "front matter is edited as a keyed patch over the original YAML
text, not parsed-and-redumped" without saying how. The obvious route —
`parseDocument` → `doc.setIn()` → `doc.toString()` — *is* parse-and-redump. It
keeps comments and key order, but it re-renders every line from the AST:

```
- layout:      post              →  + layout: post
- tags:     [ one,   two ]       →  + tags: [ one, two ]
- description: >                 →  + description: > (folded onto one line)
    A folded scalar
    spanning two lines.
```

That is exactly the laundering the invariant forbids, and `keepSourceTokens`
does not prevent it — the flag preserves the tokens, but `toString()` ignores
them.

The working route is the **CST API**: `Parser` → `Composer({keepSourceTokens})`
→ `CST.setScalarValue(node.srcToken, value)` → `CST.stringify(token)`. This
re-emits every byte the parser saw, so untouched lines are untouched. All three
fixtures (comments, nested maps, block/folded/literal scalars, flow arrays,
anchors/aliases, odd spacing, unicode) pass byte-identical on a no-op patch, and
a real edit changes exactly one line — keeping the trailing comment and even the
original `title:    ` alignment.

**2. The cost is ~30 kB gzipped, not the ~15 kB the doc assumed — and it does
not tree-shake.**

```
patcher (yaml CST + our code)   98.8 kB raw   30.5 kB gzip   27.5 kB brotli
yaml: full library              100.9 kB      31.3 kB        28.2 kB
yaml: parse-only                 95.5 kB      29.8 kB        26.9 kB
```

CST-only saves 0.8 kB over the entire library: `Parser` + `Composer` pull in
nearly everything. Budget still works (~30 + ~4 Preact + ~13 markdown ≈ 47 kB,
leaving ~50 kB for the app) but the headroom is half what the doc assumed.

Mitigation if it gets tight: the patcher is only needed in the editor view, not
the post list — code-split it behind the editor route so first paint doesn't pay
for it.

## The hole: adding a key that doesn't exist yet

`CST.setScalarValue` only edits **existing** scalars. Front-matter inference
(adding `description` to a post that lacks it) has no CST path. Two options,
per `probe-addkey.js`:

- **AST route** (`doc.setIn` + `toString`) — works, launders the file. Rejected.
- **Text append** — insert the line into the front-matter text before the closing
  `---`. Adds exactly one line, touches nothing else. **Recommended.**

Two caveats on the text route, both real and both unsolved here:

1. **Comment adoption.** Appending after the last key lands the new field under
   whatever comment block ends the front matter. In fixture 01 the new
   `description` falls under `# Taxonomy below`, which now reads as if it labels
   it. Cosmetic, but it violates the spirit of "never launder the owner's file."
   Probably wants insertion after the last *uncommented* key, or beside a
   sibling key if one is known.
2. **Escaping.** A hand-built line must serialize the value correctly — a title
   containing `: `, a leading `#`, or a quote will produce broken YAML. Do not
   hand-roll this: use `yaml`'s `stringify(value)` for the scalar alone, which
   we are already paying for.

## What to keep

- Use the CST route for existing keys; text-append for new keys.
- Fixtures in `fixtures/` are worth promoting into the real test suite verbatim —
  they caught the AST laundering immediately.
- Update DESIGN.md: the ~15 kB estimate and the bare "keyed patch" hand-wave.

## Run it

```
pnpm install
pnpm start        # round-trip fixtures
pnpm size         # bundle cost
node probe-addkey.js
```
