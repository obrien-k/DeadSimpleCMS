// The one wrapper around the `yaml` library. Nothing outside this directory
// may import `yaml` (enforced by scripts/lint-yaml-wrapper.js): the typing
// fixes below are per-call-site discipline with no global switch, so a single
// missed call site silently changes what a post says on the live site.
//
// Two facts drive everything here (prototype-verified against real Psych,
// docs/DESIGN.md "Front-matter round-trip safety"):
// - The AST API (parseDocument → toString) launders files: it re-renders every
//   line, normalising spacing, folded scalars, and flow collections. Only the
//   CST API re-emits every byte the parser saw. The AST is used below solely
//   for *positions and existence*, never to produce output text.
// - Jekyll parses with Psych (YAML 1.1); this library defaults to 1.2, and its
//   CST path quotes only for structural breakage. Left alone, both write paths
//   re-type values (`yes`→true, `12:30`→45000, `0777`→511, `2024-03-01`→Date).
import {
  Parser,
  Composer,
  CST,
  isScalar,
  parse as yamlParse,
  parseDocument,
  stringify as yamlStringify,
} from 'yaml';

const FM = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/;

// Jekyll reads at 1.1; so must every stringify/parse here, or the app and the
// site disagree about what a file means.
const YAML_11 = { version: '1.1' } as const;

// The phase-1 form's field order (DESIGN.md "Jekyll-aware, zero config"). Not
// cosmetic: it is the rule for where a new key gets inserted.
export const FORM_ORDER = ['title', 'date', 'description', 'tags', 'categories', 'image'];

export type Edits = Record<string, unknown>;

export interface SplitFile {
  open: string;
  yaml: string;
  close: string;
  body: string;
}

// Split a Jekyll file into front matter and body. The body is never parsed —
// only sliced — so nothing downstream can touch it.
export function split(raw: string): SplitFile | null {
  const m = raw.match(FM);
  if (!m) return null;
  return { open: m[1]!, yaml: m[2]!, close: m[3]!, body: raw.slice(m[0].length) };
}

// Parse a file the way Jekyll will read it. Returns null when there is no
// front matter (which is how Jekyll treats such a file too: not a post).
export function read(raw: string): { data: Record<string, unknown>; body: string } | null {
  const parts = split(raw);
  if (!parts) return null;
  const data = (yamlParse(parts.yaml, YAML_11) ?? {}) as Record<string, unknown>;
  return { data, body: parts.body };
}

// A whole YAML document, not front matter — `_config.yml` is the only caller
// (#17, resolving where Jekyll reads from). It routes through this wrapper
// because Jekyll reads _config.yml with the same Psych (YAML 1.1) parser as
// front matter, so it needs the same version discipline; the module's name is
// the only thing about that which is odd.
// Non-mappings (empty file, a bare scalar, a list) come back as {}: every
// caller wants keys or nothing. Malformed YAML throws — such a site cannot
// build at all, so the caller decides whether that is worth reporting.
export function parseYaml(raw: string): Record<string, unknown> {
  const data = yamlParse(raw, YAML_11) as unknown;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

const isScalarValue = (v: unknown): v is string | number | boolean | null =>
  v === null || typeof v !== 'object';

// Force quotes exactly when the 1.1 serializer says the plain form would be
// re-typed by Psych. Over-quoting is safe; under-quoting is silent.
const needsQuoting = (value: string): boolean =>
  yamlStringify(value, YAML_11).trim() !== value;

const lineOf = (text: string, offset: number): number =>
  text.slice(0, offset).split('\n').length - 1;

// Detect the file's own nesting indent rather than trusting stringify's
// default of 2. Whole comment and sequence-item lines are dropped, not just
// their markers: stripping the "#" off "# Post metadata" leaves " Post
// metadata", which reads as a 1-space indent.
function detectIndent(yamlText: string): number {
  const cleaned = yamlText.replace(/^[ \t]*#.*$/gm, '').replace(/^[ \t]*-.*$/gm, '');
  const m = /^([ \t]+)\S/m.exec(cleaned);
  return m ? m[1]!.length : 2;
}

interface KeySpan {
  name: string;
  startLine: number;
  endLine: number;
}

// Top-level keys with the line span each one *owns*. range[1] sits past the
// trailing newline for multi-line values (a block sequence's "end" is the next
// key's line), and range[2] runs on through trailing comments — both would put
// an insertion one key too late, so walk back to the last non-whitespace byte
// the value actually owns.
function keySpans(yamlText: string): KeySpan[] {
  const doc = parseDocument(yamlText, YAML_11);
  const items = (doc.contents as { items?: unknown[] } | null)?.items ?? [];
  return (items as { key: { value: unknown; range: number[] }; value: { range: number[] } | null }[]).map(
    (pair) => {
      const end = (pair.value ?? pair.key).range[1]!;
      const owned = yamlText.slice(0, end).replace(/\s+$/, '');
      return {
        name: String(pair.key.value),
        startLine: lineOf(yamlText, pair.key.range[0]!),
        endLine: lineOf(yamlText, Math.max(owned.length - 1, 0)),
      };
    },
  );
}

// Serialize `key: value` through the library — never hand-build the line. A
// value with ": ", a leading "#", or quotes emits broken YAML otherwise.
function renderKey(key: string, value: unknown, indent: number): string {
  if (value !== null && typeof value === 'object') {
    return yamlStringify({ [key]: value }, { ...YAML_11, indent }).replace(/\n$/, '');
  }
  return `${key}: ${yamlStringify(value, YAML_11).replace(/\n$/, '')}`;
}

// Where does a new `key` line go? After the last present key that precedes it
// in FORM_ORDER — chosen by FILE position, never form position, since files
// order keys their own way (#6). Falls back to before the first key. This
// dissolves comment adoption: a new `description` lands after `date`, above a
// `# Taxonomy below` comment, which goes on labelling the taxonomy.
function insertKeyText(yamlText: string, key: string, value: unknown): string {
  const rank = FORM_ORDER.indexOf(key);
  const spans = keySpans(yamlText);
  const predecessors =
    rank === -1
      ? spans // unknown-to-the-form keys go last
      : spans.filter((s) => {
          const r = FORM_ORDER.indexOf(s.name);
          return r !== -1 && r < rank;
        });

  const lines = yamlText.split('\n');
  let after: number;
  if (predecessors.length > 0) {
    after = predecessors.reduce((a, b) => (b.endLine > a.endLine ? b : a)).endLine;
  } else if (spans.length > 0) {
    after = spans[0]!.startLine - 1;
  } else {
    after = lines.length - 1;
  }

  const rendered = renderKey(key, value, detectIndent(yamlText));
  lines.splice(after + 1, 0, ...rendered.split('\n'));
  return lines.join('\n');
}

// Replace an existing top-level key's whole value (the non-scalar edit path:
// tags, categories, image). Only the replaced key is re-rendered; every other
// line is untouched. The old value's own formatting is necessarily lost — it
// is the thing being replaced.
function replaceKeyText(yamlText: string, key: string, value: unknown): string {
  const span = keySpans(yamlText).find((s) => s.name === key);
  if (!span) throw new Error(`cannot replace "${key}": key absent`);
  const lines = yamlText.split('\n');
  const rendered = renderKey(key, value, detectIndent(yamlText));
  lines.splice(span.startLine, span.endLine - span.startLine + 1, ...rendered.split('\n'));
  return lines.join('\n');
}

// Apply {key: value} edits to front matter, preserving every untouched byte
// (spacing, quoting, comments, key order). Dotted paths address nested
// scalars ("image.path"). Keys absent from the file are inserted per the form
// order rule; non-scalar values replace the key wholesale.
export function patch(raw: string, edits: Edits): string {
  const parts = split(raw);
  if (!parts) throw new Error('no front matter');

  const tokens = [...new Parser().parse(parts.yaml)];
  const docs = [...new Composer({ keepSourceTokens: true }).compose(tokens)];
  const doc = docs[0];
  if (!doc) throw new Error('no yaml document');

  const textOps: { op: 'insert' | 'replace'; key: string; value: unknown }[] = [];

  for (const [path, value] of Object.entries(edits)) {
    const keys = path.split('.');
    const node = doc.getIn(keys, true);

    if (isScalarValue(value) && isScalar(node) && node.srcToken) {
      const str = String(value);
      CST.setScalarValue(
        node.srcToken,
        str,
        typeof value === 'string' && needsQuoting(str)
          ? { type: 'QUOTE_DOUBLE' }
          : undefined,
      );
      continue;
    }

    const top = keys[0]!;
    if (doc.hasIn([top])) {
      // Existing key, non-scalar value (or a dotted path whose leaf is
      // missing): merge into the current value and re-render the key.
      let merged = value;
      if (keys.length > 1) {
        const current = doc.getIn([top]);
        const base =
          current && typeof current === 'object' && 'toJSON' in current
            ? (current as { toJSON(): unknown }).toJSON()
            : current;
        merged = deepSet(isRecord(base) ? { ...base } : {}, keys.slice(1), value);
      }
      textOps.push({ op: 'replace', key: top, value: merged });
    } else {
      textOps.push({
        op: 'insert',
        key: top,
        value: keys.length > 1 ? deepSet({}, keys.slice(1), value) : value,
      });
    }
  }

  let yamlText = tokens.map((t) => CST.stringify(t)).join('');
  for (const { op, key, value } of textOps) {
    yamlText =
      op === 'replace' ? replaceKeyText(yamlText, key, value) : insertKeyText(yamlText, key, value);
  }

  return parts.open + yamlText + parts.close + parts.body;
}

// Build a brand-new file (the new-draft path). Fields render in form order;
// empty strings and empty arrays are omitted rather than written as noise.
export function create(fields: Record<string, unknown>, body: string): string {
  const lines: string[] = [];
  const keys = [
    ...FORM_ORDER.filter((k) => k in fields),
    ...Object.keys(fields).filter((k) => !FORM_ORDER.includes(k)),
  ];
  for (const key of keys) {
    const value = fields[key];
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    lines.push(renderKey(key, value, 2));
  }
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function deepSet(
  target: Record<string, unknown>,
  keys: string[],
  value: unknown,
): Record<string, unknown> {
  let cursor = target;
  for (const k of keys.slice(0, -1)) {
    const next = cursor[k];
    cursor[k] = isRecord(next) ? { ...next } : {};
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = value;
  return target;
}
