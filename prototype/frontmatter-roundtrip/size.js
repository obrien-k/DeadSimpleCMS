// PROTOTYPE — throwaway. Measures the real tree-shaken + gzipped cost of the
// patcher against the ~100 kB total budget.

import { build } from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const entries = {
  'patcher (yaml CST + our split/patch)': `export { patch } from './patch.js';`,
  'yaml: full library (for contrast)': `export * from 'yaml';`,
  'yaml: parse-only (for contrast)': `import {parse} from 'yaml'; export {parse};`,
};

const fmt = (n) => (n / 1024).toFixed(1).padStart(6) + ' kB';

console.log('\nTree-shaken, minified, ESM, browser target\n');
console.log('  ' + 'entry'.padEnd(38) + 'raw'.padStart(9) + 'gzip'.padStart(10) + 'brotli'.padStart(10));
console.log('  ' + '-'.repeat(67));

for (const [label, contents] of Object.entries(entries)) {
  const result = await build({
    stdin: { contents, resolveDir: import.meta.dirname, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    legalComments: 'none',
  });
  const code = result.outputFiles[0].contents;
  console.log(
    '  ' + label.padEnd(38) +
    fmt(code.length).padStart(9) +
    fmt(gzipSync(code, { level: 9 }).length).padStart(10) +
    fmt(brotliCompressSync(code).length).padStart(10)
  );
}

console.log('\n  Budget context: ~100 kB gzipped total, also holding Preact (~4 kB),');
console.log('  a markdown renderer (~10-15 kB), and the app itself.\n');
