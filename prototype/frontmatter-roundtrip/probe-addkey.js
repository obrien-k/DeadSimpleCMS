// PROTOTYPE — throwaway. Probes the gap patch.js can't cover: adding a key
// that doesn't exist yet. Front-matter inference requires this.

import { readFileSync } from 'node:fs';
import { Document, parseDocument } from 'yaml';
import { split } from './patch.js';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', X = '\x1b[0m';
const raw = readFileSync(new URL('./fixtures/01-comments-and-order.md', import.meta.url), 'utf8');

console.log(`\n${'='.repeat(60)}\nAdding a new key: description\n${'='.repeat(60)}\n`);

// Option A: the AST route (doc.setIn + toString) — what the design implied.
console.log(`${D}Option A — doc.setIn + toString():${X}`);
const parts = split(raw);
const doc = parseDocument(parts.yaml);
doc.setIn(['description'], 'A new description');
const astOut = doc.toString({ lineWidth: 0 });
const collateral = astOut.split('\n').filter((l, i) => {
  const orig = parts.yaml.split('\n')[i];
  return orig !== undefined && l !== orig && !l.startsWith('description');
});
console.log(astOut.split('\n').map((l) => '   ' + l).join('\n'));
console.log(collateral.length
  ? `\n   ${R}✗ ${collateral.length} unrelated line(s) reformatted — laundering${X}`
  : `\n   ${G}✓ no collateral${X}`);

// Option B: text insertion before the closing delimiter.
console.log(`\n${D}Option B — append the line to the front-matter text:${X}`);
const textOut = parts.open + parts.yaml + '\ndescription: A new description' + parts.close + parts.body;
const changed = textOut.split('\n').filter((l) => !raw.split('\n').includes(l));
console.log(textOut.split('\n').slice(0, 14).map((l) => '   ' + l).join('\n'));
console.log(`   ${D}…${X}`);
console.log(`\n   ${G}✓ exactly ${changed.length} line added, nothing else touched${X}`);
console.log(`   ${D}but: appends after the last key — lands under the "# Taxonomy below"${X}`);
console.log(`   ${D}comment, which now reads as if it labels the new field.${X}\n`);
