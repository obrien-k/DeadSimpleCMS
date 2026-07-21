# ADR-0010: Write YAML 1.1, and force quotes on the CST path

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #10
- **Code:** `src/frontmatter/`
- **Related:** ADR-0002 (the CST API)

## Context

Jekyll parses front matter with Ruby's Psych, which is **YAML 1.1**. The JS `yaml` library is **YAML 1.2**. They disagree about what a file *means*, by default, on every write path.

Structural escaping is not enough. The library protects syntax; the **type** layer leaks — and ADR-0002's CST path, the primary edit path, is the worse of the two.

## Decision

- **New keys** → `stringify(value, { version: '1.1' })`.
- **Existing keys** → `CST.setScalarValue(token, value, { type: 'QUOTE_DOUBLE' })` **when** `stringify(value, {version:'1.1'}).trim() !== value` — i.e. force quotes exactly when the 1.1 serializer says the plain form would be re-typed.
- **Reads** parse at `1.1` too.

Values that need no quoting keep the owner's formatting.

Wrap the library once and never call it directly (ADR-0002).

## Evidence

Verified against real Ruby Psych (`prototype/frontmatter-roundtrip/psych-oracle.rb`, called as Jekyll calls it), 14 values per path, counting how many Jekyll silently re-types:

| write path | wrong | Jekyll reads |
|---|---|---|
| `stringify` @1.2 (library default) | **10** | `yes`→`true`, `NO`→`false`, `12:30`→`45000`, `1_000`→`1000`, `2024-03-01`→`Date` |
| `stringify` @1.1 | **0** | — |
| **`CST.setScalarValue` (naive)** | **11** | the above **plus `0777`→`511`** |
| CST + forced quote when unsafe | **0** | — |

- **`CST.setScalarValue` quotes only for structural breakage** (`a: b`, `#hash`) — it protects syntax, not types — and **inherits the source's quote style**, so it is safe only when the owner happened to quote the original. Editing `title: The Old Title` to `yes` emits `title: yes`, and the site gets boolean `true`.
- There is **no `version` option on the CST API**; it is a byte-level operation. Hence the forced-quote rule rather than configuration.
- **The trap is wider than booleans:** sexagesimals (`12:30`→`45000`), octal (`0777`→`511`), underscored digits (`1_000`→`1000`) and dates (`2024-03-01`→a `Date`) all re-type. Booleans are only the memorable case.

## Consequences

- **The JS `yaml` library is not an oracle for Jekyll.** Both call themselves YAML 1.1 and disagree — the JS lib treats `y`/`n` as booleans, Psych does not. Asking the JS reader whether the JS writer was safe only proves the library agrees with itself. **Psych answers, or nothing does**, which is why `psych-oracle.rb` exists and is kept.
- **The fix is per-call-site discipline, not configuration.** There is no global switch, and the CST API has no `version` option at all. A single missed call site silently changes what a post says, and the JS test path cannot see it break. #10 exists to enforce the wrapper.
- One reachable failure mode disappears as a side effect: a stray quote in front matter can no longer be emitted, which retires it as a build-failure example (ADR-0014).
