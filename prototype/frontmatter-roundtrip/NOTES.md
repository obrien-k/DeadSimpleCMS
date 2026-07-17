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

## The hole: adding a key that doesn't exist yet — **closed by #6**

`CST.setScalarValue` only edits **existing** scalars, so adding a key has no CST
path. Two options, per `probe-addkey.js`:

- **AST route** (`doc.setIn` + `toString`) — works, launders the file. Rejected.
- **Text insertion** — splice the key into the front-matter text. Touches nothing
  else. **Chosen.**

Both caveats this file left open are now settled by `probe-insert.js`. See #6 for
the reasoning; the findings:

**1. Comment adoption — dissolved, not mitigated.** The rule is **insert in *form*
order relative to keys already present**: after the last present key that precedes
the new one in the form's field order (`title → date → description → tags →
categories → image`). In fixture 01 a new `description` lands after `date` and
*above* `# Taxonomy below`, so the comment goes on labelling the taxonomy. The bug
never fires rather than being special-cased. Existing keys never move.

**Rank by FILE position, never by form position.** Fixture 01 orders `categories`
before `tags`; the form is the reverse. A rule that trusted form order would insert
into the wrong place in any file whose author ordered keys their own way.

**2. Escaping — `stringify()` handles structure; *typing* is a separate problem that
bites both write paths.** `stringify()` correctly escapes `: `, a leading `#`, mixed
quotes, unicode, and empty string. But **structurally valid is not "means the same
thing"**, and the type layer is where both paths leak.

**Verified against real Ruby Psych** (`psych-oracle.rb`, Psych 5.0.1 / libyaml 0.2.5,
called the way Jekyll calls it — `safe_load` with `Date`/`Time` permitted). 14 values,
per write path, counting how many Jekyll re-types:

| write path | wrong | what Jekyll actually reads |
|---|---|---|
| `stringify` @1.2 (library default) | **10** | `yes`→`true`, `NO`→`false`, `12:30`→`45000`, `1_000`→`1000`, `2024-03-01`→`Date` |
| `stringify` @1.1 | **0** | — |
| **`CST.setScalarValue` (as written)** | **11** | all of the above **plus `0777`→`511`** |
| CST + forced quote when unsafe | **0** | — |

**The CST path is the primary edit path and it is the worse of the two.**
`CST.setScalarValue` quotes only for *structural* breakage (`a: b`, `#hash`) — it
protects the document's syntax, not its types — and it **inherits the source's quote
style**, so it is safe only when the original value happened to be quoted. Against
the realistic unquoted `title: The Old Title`, editing the title to `yes` emits
`title: yes` and the site gets boolean `true`. There is no `version` option on the CST
API; it is a byte-level operation.

**The rule, both paths:**

- **New keys:** `stringify(value, { version: '1.1' })`.
- **Existing keys:** `CST.setScalarValue(token, value, { type: 'QUOTE_DOUBLE' })`
  **when** `stringify(value, {version:'1.1'}).trim() !== value` — i.e. force quotes
  exactly when the 1.1 serializer says the plain form would be re-typed. Reuses the
  library already paid for, and leaves untouched values formatted as the owner had them.
- **Reads:** parse at `{ version: '1.1' }` too, or the app disagrees with Jekyll about
  what it just loaded.

**The trap is wider than booleans.** Sexagesimals (`12:30` → `45000`), octal (`0777` →
`511`), underscored digits (`1_000` → `1000`) and dates (`2024-03-01` → a `Date`
object) all re-type. Booleans are just the memorable case.

**And the JS library is not an oracle for Jekyll.** Both call themselves YAML 1.1 and
they disagree: **the JS lib treats `y`/`n` as booleans; Psych does not.** Asking the JS
reader whether the JS writer was safe only proves the library agrees with itself — the
first version of this probe did exactly that, "passed", and reported a `y`→`true` bug
that Jekyll does not actually have while missing the sexagesimal one it does. **Psych
answers, or nothing does.** Over-quoting is safe; under-quoting is silent.

**3. Nested keys are a block, not a line — and the design's own example is one.**
`image.path` where `image` is absent needs a nested block, and cover image is in the
*phase-1* form, so this is not deferrable to inference. `stringify({image:{...}})`
emits it correctly; **indent must be detected from the file**, not left at
stringify's default of 2, or a 4-indented file gets a foreign-looking block.

**4. Two off-by-ones worth keeping** — both bit this probe:
- Detecting indent by stripping comment *markers* leaves `" Post metadata"` from
  `"# Post metadata"` and reads as a 1-space indent. Drop whole comment and
  sequence-item **lines**.
- A pair's `range[1]` sits *past* the trailing newline for multi-line values, so a
  block sequence's "end line" is the *next* key's line and insertion lands one key
  late. Walk back to the last non-whitespace byte the value owns.

**Residual:** when the new key is last in form order and no successor is present,
insertion still lands at the end of the block, where a trailing comment can still
adopt it. Rarer, and unavoidable — **YAML comments have no owner**, so whether
`# Taxonomy below` heads `tags` or trails `date` is undecidable. The rule minimises
damage; it is not correct, because correct is not available.

## What to keep

- Use the CST route for existing keys; form-order text insertion for new keys.
- **The quoting rule above is load-bearing on both paths** — `{ version: '1.1' }` on
  every `stringify`/`parse`, and `type: 'QUOTE_DOUBLE'` on the CST path whenever the
  1.1 serializer would quote. Not a preference; the CST default is wrong 11 times in 14.
- **`psych-oracle.rb` is the only real evidence in this directory.** Any future claim
  about what Jekyll reads goes through it, not through the JS parser.
- Fixtures in `fixtures/` are worth promoting into the real test suite verbatim —
  they caught the AST laundering immediately, and fixture 01's
  categories-before-tags caught the form-order-vs-file-order bug in #6.
- Update DESIGN.md: the ~15 kB estimate and the bare "keyed patch" hand-wave.

## Run it

```
pnpm install
pnpm start        # round-trip fixtures
pnpm size         # bundle cost
node probe-addkey.js    # why text insertion, not the AST route
node probe-insert.js    # #6: where the inserted key goes
```
