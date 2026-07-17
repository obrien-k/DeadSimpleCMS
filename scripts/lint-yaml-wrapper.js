// #10: the YAML typing rule (version 1.1, forced quotes on the CST path) is
// per-call-site discipline with no global switch, so the only safe number of
// call sites is one. Everything outside src/frontmatter/ must go through the
// wrapper; a direct `yaml` import anywhere else is a lint failure.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src', import.meta.url).pathname;
const allowed = join(root, 'frontmatter');
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !p.startsWith(allowed)) {
      const src = readFileSync(p, 'utf8');
      if (/from\s+['"]yaml['"]|require\(\s*['"]yaml['"]\s*\)/.test(src)) {
        offenders.push(relative(root, p));
      }
    }
  }
}

walk(root);
if (offenders.length) {
  console.error('direct `yaml` import outside src/frontmatter/ (use the wrapper):');
  for (const f of offenders) console.error(`  src/${f}`);
  process.exit(1);
}
console.log('yaml-wrapper lint: ok');
