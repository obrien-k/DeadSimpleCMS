// PROTOTYPE — throwaway. Answers: can we patch Jekyll front matter without
// laundering it, inside the bundle budget? See NOTES.md for the verdict.

import { Parser, Composer, CST } from 'yaml';

const FM = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/;

// Split a Jekyll file into front matter text and everything after it. The body
// is never parsed — only sliced — so nothing downstream can touch it.
export function split(raw) {
  const m = raw.match(FM);
  if (!m) return null;
  return { open: m[1], yaml: m[2], close: m[3], body: raw.slice(m[0].length) };
}

// Apply {dotted.path: value} edits to front matter.
//
// Works on the CST, not the AST: CST.stringify re-emits every byte the parser
// saw, so untouched lines keep their original spacing, quoting, and comments.
// doc.toString() cannot do this — it re-renders from the AST and normalizes
// whitespace, folded scalars, and flow collections. See NOTES.md.
export function patch(raw, edits) {
  const parts = split(raw);
  if (!parts) throw new Error('no front matter');

  const tokens = [...new Parser().parse(parts.yaml)];
  const docs = [...new Composer({ keepSourceTokens: true }).compose(tokens)];
  const doc = docs[0];
  if (!doc) throw new Error('no yaml document');

  for (const [path, value] of Object.entries(edits)) {
    const keys = path.split('.');
    const node = doc.getIn(keys, true); // true = return the Scalar node itself
    if (!node?.srcToken) {
      throw new Error(`cannot patch "${path}": key absent (add-key is unsolved)`);
    }
    CST.setScalarValue(node.srcToken, value);
  }

  const yamlText = tokens.map((t) => CST.stringify(t)).join('');
  return parts.open + yamlText + parts.close + parts.body;
}
