// Bundle budget gate: DESIGN.md's hard limit is ~100 kB gzipped for the whole
// admin bundle. Fails the build the day the budget is blown, not the release.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LIMIT = 100 * 1024;
const path = new URL('../dist/bundle.js', import.meta.url);

let raw;
try {
  raw = readFileSync(path);
} catch {
  console.error('budget: dist/bundle.js not found — run `pnpm build` first');
  process.exit(1);
}

const gz = gzipSync(raw, { level: 9 }).length;
const pct = ((gz / LIMIT) * 100).toFixed(1);
console.log(`bundle: ${raw.length} B raw, ${gz} B gzip (${pct}% of ${LIMIT} B budget)`);
if (gz > LIMIT) {
  console.error(`budget: EXCEEDED by ${gz - LIMIT} B gzip`);
  process.exit(1);
}
