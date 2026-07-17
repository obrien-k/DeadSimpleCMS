// PROTOTYPE — throwaway. Answers #6: where does a new front-matter key get
// inserted? Sits beside probe-addkey.js, which established *that* the text route
// is the only non-laundering option; this settles *where* the text goes.
//
//   node probe-insert.js
//
// The rule under test: insert in FORM order relative to keys already present.
// The phase-1 form has a fixed field order, so no corpus and no sampling are
// needed — which also means this works before inference exists.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify, Parser, Composer, CST } from 'yaml';
import { split } from './patch.js';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m';

// The phase-1 form's field order, per DESIGN.md's "Jekyll-aware, zero config".
// Note it disagrees with fixture 01, which puts categories before tags — file
// order and form order are NOT the same thing, and the rule must survive that.
const FORM_ORDER = ['title', 'date', 'description', 'tags', 'categories', 'image'];

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const lineOf = (text, offset) => text.slice(0, offset).split('\n').length - 1;

// Detect the file's own nesting indent rather than trusting stringify's default
// of 2 — a file indented 4 would get a foreign-looking block bolted into it.
// Whole comment and sequence-item lines are dropped, not just their markers:
// stripping the "#" off "# Post metadata" leaves " Post metadata", which reads
// as a 1-space indent and silently mis-indents every block this emits.
function detectIndent(yamlText) {
  const cleaned = yamlText
    .replace(/^[ \t]*#.*$/gm, '')
    .replace(/^[ \t]*-.*$/gm, '');
  const m = /^([ \t]+)\S/m.exec(cleaned);
  return m ? m[1].length : 2;
}

// Where does `key` go? Returns the line index to insert AFTER (-1 = before the
// first key line). Rule: after the last present key that precedes `key` in form
// order, chosen by FILE position — never form position, since the two disagree.
function findInsertLine(yamlText, key) {
  const doc = parseDocument(yamlText);
  const rank = FORM_ORDER.indexOf(key);
  if (rank === -1) throw new Error(`"${key}" is not a form field`);

  const present = (doc.contents?.items ?? []).map((pair) => {
    // range[1] is the end of the value proper. range[2] runs on through trailing
    // comments and blank lines, which would drag the insertion point past the
    // very comment block this rule exists to stay above.
    //
    // Even range[1] overshoots for multi-line values: a block sequence's end
    // sits *after* its final newline, i.e. on the next key's line, so a naive
    // lineOf() inserts one key too late. Walk back to the last non-whitespace
    // byte the value actually owns.
    const end = (pair.value ?? pair.key).range[1];
    const owned = yamlText.slice(0, end).replace(/\s+$/, '');
    return {
      name: String(pair.key.value),
      endLine: lineOf(yamlText, Math.max(owned.length - 1, 0)),
    };
  });

  const predecessors = present.filter((p) => {
    const r = FORM_ORDER.indexOf(p.name);
    return r !== -1 && r < rank;
  });
  if (predecessors.length === 0) {
    const first = present[0];
    return { after: first ? lineOf(yamlText, doc.contents.items[0].key.range[0]) - 1 : yamlText.split('\n').length - 1, reason: 'no predecessor present — before the first key' };
  }
  const last = predecessors.reduce((a, b) => (b.endLine > a.endLine ? b : a));
  return { after: last.endLine, reason: `after "${last.name}" (last present form-predecessor, by file position)` };
}

// Serialize through yaml's stringify — never hand-build the line. A title with
// ": ", a leading "#", or a quote emits broken YAML otherwise.
//
// version:'1.1' is load-bearing, not a nicety. This library defaults to YAML
// 1.2, where `yes` is the string "yes". Jekyll parses with Ruby's Psych, which
// is YAML *1.1*, where bare `yes` is boolean true — so a 1.2-serialized title
// of "yes" silently becomes `true` on the site. 1.1 mode quotes it.
const YAML_OPTS = { version: '1.1' };

function renderKey(key, value, indent) {
  if (value !== null && typeof value === 'object') {
    const block = stringify({ [key]: value }, { ...YAML_OPTS, indent });
    return block.replace(/\n$/, ''); // stringify always adds a trailing newline
  }
  return `${key}: ${stringify(value, YAML_OPTS).replace(/\n$/, '')}`;
}

function insertKey(raw, key, value) {
  const parts = split(raw);
  const indent = detectIndent(parts.yaml);
  const { after, reason } = findInsertLine(parts.yaml, key);
  const lines = parts.yaml.split('\n');
  const rendered = renderKey(key, value, indent);
  lines.splice(after + 1, 0, ...rendered.split('\n'));
  return { out: parts.open + lines.join('\n') + parts.close + parts.body, reason, indent, rendered };
}

// Everything outside the inserted lines must be byte-identical. This is the
// same invariant the CST route protects for edits.
function collateral(before, after, rendered) {
  const inserted = rendered.split('\n');
  const remaining = [...after.split('\n')];
  for (const line of inserted) {
    const i = remaining.indexOf(line);
    if (i !== -1) remaining.splice(i, 1);
  }
  return remaining.join('\n') === before ? null : { before, after: remaining.join('\n') };
}

console.log(`\n${'='.repeat(68)}\n#6 — where does a new front-matter key go?\n${'='.repeat(68)}`);
console.log(`${D}form order: ${FORM_ORDER.join(' → ')}${X}`);

// --- 1. THE COMMENT-ADOPTION CASE -------------------------------------------
console.log(`\n${Y}1. description → fixture 01 (the case that motivated the ticket)${X}`);
{
  const raw = fx('01-comments-and-order.md');
  const { out, reason } = insertKey(raw, 'description', 'A new description');
  console.log(`   ${D}${reason}${X}`);
  out.split('\n').slice(0, 11).forEach((l) => {
    const isNew = l.startsWith('description:');
    console.log(`   ${isNew ? G + '+ ' : D + '  '}${l}${X}`);
  });
  const lines = out.split('\n');
  const descAt = lines.findIndex((l) => l.startsWith('description:'));
  const commentAt = lines.findIndex((l) => l.startsWith('# Taxonomy below'));
  const ok = descAt < commentAt;
  console.log(`   ${ok ? G + '✓' : R + '✗'} description is ${ok ? 'ABOVE' : 'BELOW'} "# Taxonomy below" — comment still labels the taxonomy${X}`);
  const c = collateral(split(raw).yaml, split(out).yaml, 'description: A new description');
  console.log(`   ${c ? R + '✗ collateral damage' : G + '✓ every other byte identical'}${X}`);
}

// --- 2. FILE ORDER vs FORM ORDER --------------------------------------------
// Fixture 01 has categories BEFORE tags; the form has tags before categories.
// A rule that ranked by form position would insert into the wrong place.
console.log(`\n${Y}2. image → fixture 01 (file order disagrees with form order)${X}`);
{
  const raw = fx('01-comments-and-order.md');
  const { out, reason } = insertKey(raw, 'image', { path: '/assets/img/cover.png', alt: 'A cover' });
  console.log(`   ${D}${reason}${X}`);
  out.split('\n').slice(5, 16).forEach((l) => {
    const isNew = /^(image:|\s+(path|alt):)/.test(l);
    console.log(`   ${isNew ? G + '+ ' : D + '  '}${l}${X}`);
  });
  console.log(`   ${D}nested value → a BLOCK, not a line. This is the design's own example (image.path).${X}`);
}

// --- 3. ESCAPING ------------------------------------------------------------
console.log(`\n${Y}3. Serialization — values that break a hand-built line${X}`);
{
  const nasty = [
    ['a title with: a colon', 'colon+space starts a mapping'],
    ['#starts with a hash', 'reads as a comment'],
    ['has "double" and \'single\' quotes', 'quote soup'],
    ['emoji 🎉 and café and 日本語', 'unicode'],
    ['', 'empty string'],
    ['yes', 'YAML 1.1 boolean-ish'],
  ];
  for (const [v, why] of nasty) {
    const { out } = insertKey(fx('01-comments-and-order.md'), 'description', v);
    const line = out.split('\n').find((l) => l.startsWith('description:'));
    console.log(`   ${line.padEnd(48)} ${D}${why}${X}`);
  }
  console.log(`   ${D}structurally valid — but "valid" is not "means the same thing". See §6.${X}`);
}

// --- 4. INDENT DETECTION ----------------------------------------------------
console.log(`\n${Y}4. Indent — does the nested block match the file?${X}`);
{
  const four = `---\nlayout: post\ntitle: A post\nseo:\n    type: BlogPosting\n---\n\nBody.\n`;
  for (const [label, raw] of [['fixture 02 (2-space)', fx('02-nested-and-quoting.md')], ['synthetic (4-space)', four]]) {
    const parts = split(raw);
    const indent = detectIndent(parts.yaml);
    const rendered = renderKey('image', { path: '/a.png' }, indent);
    console.log(`   ${label.padEnd(22)} detected ${indent} → ${JSON.stringify(rendered)}`);
  }
}

// --- 5. THE FALLBACK, AND WHERE IT STILL BITES ------------------------------
console.log(`\n${Y}5. No predecessor present → fallback${X}`);
{
  const raw = fx('03-odd-spacing-and-flow.md'); // has title, so use a fixture without one
  const noTitle = `---\n# Header comment\ntags: [a]\n---\n\nBody.\n`;
  const { out, reason } = insertKey(noTitle, 'title', 'Inserted');
  console.log(`   ${D}${reason}${X}`);
  out.split('\n').slice(0, 5).forEach((l) => console.log(`   ${l.startsWith('title:') ? G + '+ ' : D + '  '}${l}${X}`));

  const { out: o2, reason: r2, rendered } = insertKey(fx('03-odd-spacing-and-flow.md'), 'categories', ['jekyll']);
  console.log(`\n   ${D}categories → fixture 03: ${r2}${X}`);
  const c = collateral(split(fx('03-odd-spacing-and-flow.md')).yaml, split(o2).yaml, rendered);
  console.log(`   ${c ? R + '✗ collateral damage' : G + '✓ odd spacing / anchors / unicode all preserved'}${X}`);
}

// --- 6. WHAT DOES JEKYLL ACTUALLY READ? -------------------------------------
// Both paths get checked against real Psych, because the JS library is not an
// oracle for Jekyll: asking the JS reader whether the JS writer was safe only
// proves the library agrees with itself. The first version of this probe did
// exactly that and "passed" while under-quoting six values.
console.log(`\n${Y}6. Psych oracle — both write paths, read the way Jekyll reads them${X}`);
{
  const VALUES = ['yes', 'no', 'on', 'off', 'NO', 'Off', 'y', 'n', '12:30', '12:30:00', '1_000', '0777', '2024-03-01', 'ordinary title'];

  // Path A: new key, via stringify. Path B: existing key, via the CST.
  // Path B is the primary edit path and does NOT go through stringify at all.
  const cstSet = (value, opts) => {
    const raw = 'title: The Old Title\n'; // unquoted source — the common case
    const tokens = [...new Parser().parse(raw)];
    const doc = [...new Composer({ keepSourceTokens: true }).compose(tokens)][0];
    CST.setScalarValue(doc.getIn(['title'], true).srcToken, value, opts);
    return tokens.map((t) => CST.stringify(t)).join('').replace(/^title:\s*/, '').trim();
  };

  // The rule under test: force quotes exactly when the 1.1 serializer says the
  // plain form would be re-typed. Reuses the library we already pay for.
  const needsQuoting = (v) => stringify(v, YAML_OPTS).trim() !== v;
  const paths = {
    'stringify @1.2 (library default)': (v) => stringify(v).trim(),
    "stringify @1.1": (v) => stringify(v, YAML_OPTS).trim(),
    'CST.setScalarValue (as written)': (v) => cstSet(v),
    'CST + forced quote when unsafe': (v) => cstSet(v, needsQuoting(v) ? { type: 'QUOTE_DOUBLE' } : undefined),
  };

  const tmp = join(tmpdir(), 'dscms-psych');
  mkdirSync(tmp, { recursive: true });
  let ruby = true;
  try { execFileSync('ruby', ['-v'], { stdio: 'ignore' }); } catch { ruby = false; }

  if (!ruby) {
    console.log(`   ${Y}ruby not found — skipping. This section is the only real evidence here.${X}`);
  } else {
    console.log(`   ${'path'.padEnd(34)} ${'wrong'.padEnd(6)} values Jekyll re-types`);
    for (const [label, render] of Object.entries(paths)) {
      const file = join(tmp, `${label.replace(/\W+/g, '_')}.yml`);
      writeFileSync(file, VALUES.map((v, i) => `k${i}: ${render(v)}`).join('\n') + '\n');
      const got = JSON.parse(execFileSync('ruby', [fileURLToPath(new URL('./psych-oracle.rb', import.meta.url)), file], { encoding: 'utf8' }));
      const wrong = VALUES.map((v, i) => [v, got[`k${i}`]])
        .filter(([v, r]) => !r || r[1] !== 'String' || r[0].slice(1, -1) !== v);
      const c = wrong.length === 0 ? G : R;
      console.log(`   ${label.padEnd(34)} ${c}${String(wrong.length).padEnd(6)}${X}${wrong.map(([v, r]) => `${v}→${r ? r[0] : '?'}`).join(' ')}`);
    }
    console.log(`\n   ${D}Psych does NOT treat y/n as booleans — the JS lib at 1.1 does. Both call${X}`);
    console.log(`   ${D}themselves "YAML 1.1" and disagree, which is why only Psych can answer.${X}`);
    console.log(`   ${D}Over-quoting is safe; under-quoting silently changes what a post means.${X}`);
  }
}

console.log();
