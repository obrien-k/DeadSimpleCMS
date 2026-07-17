// The only real evidence about what Jekyll reads. The JS `yaml` library is NOT
// an oracle for Jekyll — both call themselves YAML 1.1 and disagree (the JS
// lib treats y/n as booleans; Psych does not), so asking the JS reader whether
// the JS writer was safe only proves the library agrees with itself. These
// tests shell out to real Psych, called the way Jekyll calls it.
//
// Skips when ruby is absent (local machines); CI runs on ubuntu-latest, which
// ships ruby, so the oracle always runs there.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patch, split } from '../../src/frontmatter/index.js';

const ORACLE = new URL('../oracle/psych-oracle.rb', import.meta.url).pathname;

let ruby = true;
try {
  execFileSync('ruby', ['-v'], { stdio: 'ignore' });
} catch {
  ruby = false;
}

const tmp = ruby ? mkdtempSync(join(tmpdir(), 'dscms-psych-')) : '';
let n = 0;
function psychReads(yamlText: string): Record<string, [string, string]> {
  const file = join(tmp, `case-${n++}.yml`);
  writeFileSync(file, yamlText);
  return JSON.parse(execFileSync('ruby', [ORACLE, file], { encoding: 'utf8' }));
}

// The 14-value table from the round-trip prototype: every class of value the
// two write paths were measured to re-type before the quoting rule.
const VALUES = [
  'yes', 'no', 'on', 'off', 'NO', 'Off', 'y', 'n',
  '12:30', '12:30:00', '1_000', '0777', '2024-03-01', 'ordinary title',
];

describe.skipIf(!ruby)('Psych oracle: Jekyll reads back exactly what was written', () => {
  it.each(VALUES)('CST edit path: "%s" survives as a String', (v) => {
    // The common case: the owner's original value is unquoted.
    const out = patch('---\ntitle: The Old Title\n---\n\nB.\n', { title: v });
    const got = psychReads(split(out)!.yaml).title!;
    expect(got[1]).toBe('String');
    expect(got[0]).toBe(JSON.stringify(v)); // ruby inspect === JSON for plain ASCII
  });

  it.each(VALUES)('insert path: "%s" survives as a String', (v) => {
    const out = patch('---\ntitle: T\n---\n\nB.\n', { description: v });
    const got = psychReads(split(out)!.yaml).description!;
    expect(got[1]).toBe('String');
  });

  it('a fixture patched by the app still means the same thing to Psych', () => {
    const raw = `---\ntitle: Old\ndate: 2024-03-01 10:00:00 +0000\nbool_yes: yes\n---\n\nB.\n`;
    const out = patch(raw, { title: 'New' });
    const got = psychReads(split(out)!.yaml);
    expect(got.title).toEqual(['"New"', 'String']);
    expect(got.bool_yes![1]).toBe('TrueClass'); // untouched key keeps its (1.1) meaning
  });
});
