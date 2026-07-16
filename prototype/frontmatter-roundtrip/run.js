// PROTOTYPE — throwaway. `pnpm start` from this directory.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patch } from './patch.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', X = '\x1b[0m';

// LCS line diff. Index-pairing is not good enough here: any line-count change
// makes every later line look modified, which turns one folded scalar into a
// fake whole-file rewrite.
function diff(a, b) {
  const al = a.split('\n'), bl = b.split('\n');
  const n = al.length, m = bl.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = al[i] === bl[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) { i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push(`${R}- ${al[i++]}${X}`);
    else out.push(`${G}+ ${bl[j++]}${X}`);
  }
  while (i < n) out.push(`${R}- ${al[i++]}${X}`);
  while (j < m) out.push(`${G}+ ${bl[j++]}${X}`);
  return out;
}

// Each fixture: the edit to apply, and which lines we accept as changed.
const cases = {
  '01-comments-and-order.md': { 'title': 'The New Title' },
  '02-nested-and-quoting.md': { 'image.alt': 'A new alt text' },
  '03-odd-spacing-and-flow.md': { 'title': 'Patched title' },
};

let failures = 0;

for (const file of readdirSync(dir).sort()) {
  const raw = readFileSync(join(dir, file), 'utf8');
  console.log(`\n${'='.repeat(60)}\n${file}\n${'='.repeat(60)}`);

  // Check 1: identity. Patching nothing must return the file byte-for-byte.
  let identity;
  try {
    identity = patch(raw, {});
    if (identity === raw) {
      console.log(`${G}✓ identity${X}  no-op patch is byte-identical`);
    } else {
      failures++;
      console.log(`${R}✗ identity${X}  no-op patch MUTATED the file:`);
      diff(raw, identity).forEach((l) => console.log('   ' + l));
    }
  } catch (e) {
    failures++;
    console.log(`${R}✗ identity${X}  threw: ${e.message}`);
    continue;
  }

  // Check 2: targeted edit. Only the intended line may change.
  const edits = cases[file];
  try {
    const patched = patch(raw, edits);
    const lines = diff(raw, patched);
    console.log(`${D}  edit: ${JSON.stringify(edits)}${X}`);
    if (lines.length === 0) {
      failures++;
      console.log(`${R}✗ edit${X}      patch had no effect`);
    } else {
      console.log(`  diff (${lines.length} lines):`);
      lines.forEach((l) => console.log('   ' + l));
    }
  } catch (e) {
    failures++;
    console.log(`${R}✗ edit${X}      threw: ${e.message}`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(failures ? `${R}${failures} failure(s)${X}` : `${G}all identity checks passed${X}`);
console.log(`${D}Read the diffs above — a clean run still needs eyes on what changed.${X}\n`);
