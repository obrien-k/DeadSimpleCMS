// PROTOTYPE — answers the #14 budget question: what does the native downscale
// path cost against the ~41 kB gzip that remains? Bundles resize.js the same
// way scripts/budget.js measures the real app (esbuild minify → gzip level 9)
// so the number is comparable to the 41 kB headroom, not a raw byte count.
//
//   node size.js

import { gzipSync } from 'node:zlib';
import { globSync } from 'node:fs';

// Resolve esbuild from the repo's pnpm store — the prototype keeps no
// node_modules, and pnpm hides esbuild as a transitive dep of vite.
const [esbuildMain] = globSync(
  new URL('../../node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js', import.meta.url)
    .pathname,
);
const { build } = await import(esbuildMain);

const result = await build({
  entryPoints: [new URL('./resize.js', import.meta.url).pathname],
  bundle: true,
  minify: true,
  format: 'esm',
  write: false,
  platform: 'browser',
});

const raw = result.outputFiles[0].contents;
const gz = gzipSync(Buffer.from(raw), { level: 9 }).length;

console.log(`resize.js native path: ${raw.length} B raw, ${gz} B gzip`);
console.log(`  headroom is ~41 kB gzip — this path is ${(gz / 1024).toFixed(2)} kB of it`);
