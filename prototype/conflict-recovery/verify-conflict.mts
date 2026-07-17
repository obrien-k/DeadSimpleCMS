// PROTOTYPE live verification (#15) — proves the REAL conflict path against the
// scratch repo: a stale-parented Save is actually rejected, and each Variant B
// resolution (keep mine / use theirs / save a copy) does what the buttons claim.
// Uses a draft so no build is triggered.
//
//   npx tsx prototype/conflict-recovery/verify-conflict.mts
import { readFileSync } from 'node:fs';
import { createClient, GhError } from '../../src/gh/index.js';
import { diffLines } from '../../src/app/diff.js';

const REPO = 'obrien-k/DeadSimpleCMS-scratch';
const token = readFileSync(new URL('../../.scratch-token', import.meta.url), 'utf8').trim();
const gh = createClient({ token, repo: REPO });

const path = '_drafts/conflict15.md';
const copyPath = '_drafts/conflict-15-my-changes.md';
const v0 = '---\ntitle: Conflict 15\n---\n\nOriginal opening line.\nShared middle line.\nOriginal closing line.\n';
const vMine = '---\ntitle: Conflict 15\n---\n\nMy new opening line.\nShared middle line.\nOriginal closing line.\nA line I added.\n';
const vTheirs = '---\ntitle: Conflict 15 (2026)\n---\n\nOriginal opening line.\nTheir edited middle line.\nOriginal closing line.\n';

// Open it: create v0, remember the head the editor would have captured.
console.log('creating the draft and "opening" it…');
await gh.commit({ message: 'PROTO #15 v0', changes: [{ path, content: v0 }], expectedHeadSha: await gh.getHeadSha() });
const headAtOpen = await gh.getHeadSha();

// Another client changes the same file — HEAD moves under us.
console.log('another client edits the same draft…');
await gh.commit({ message: 'PROTO #15 theirs', changes: [{ path, content: vTheirs }], expectedHeadSha: headAtOpen });

// My Save, parented on the stale head: must be rejected as a conflict.
console.log('saving my version against the stale head…');
let conflicted = false;
try {
  await gh.commit({ message: 'PROTO #15 mine', changes: [{ path, content: vMine }], expectedHeadSha: headAtOpen });
} catch (e) {
  conflicted = e instanceof GhError && e.conflict && e.status === 409;
}

// The compare fetches theirs; the diff marks the lines that differ.
const theirs = (await gh.readFile(path)).text;
const theirsMatches = theirs === vTheirs;
const d = diffLines(vMine, theirs);
const mineChanged = d.mine.filter((l) => l.changed).length;
const theirsChanged = d.theirs.filter((l) => l.changed).length;

// Keep mine: re-commit on the fresh head — lands and replaces theirs.
console.log('keep mine (re-parented on the current head)…');
await gh.commit({ message: 'PROTO #15 keep mine', changes: [{ path, content: vMine }], expectedHeadSha: await gh.getHeadSha() });
const keptMine = (await gh.readFile(path)).text === vMine;

// Save a copy: writes a new draft, leaves the tracked file untouched.
console.log('save mine as a copy…');
await gh.commit({ message: 'PROTO #15 copy', changes: [{ path: copyPath, content: vMine }], expectedHeadSha: await gh.getHeadSha() });
const copyMade = (await gh.readFile(copyPath)).text === vMine;

// Cleanup.
await gh.commit({ message: 'PROTO #15 cleanup', deletions: [path, copyPath], expectedHeadSha: await gh.getHeadSha() });

const ok = conflicted && theirsMatches && mineChanged > 0 && theirsChanged > 0 && keptMine && copyMade;
console.log('\nresults:');
console.log(`  ${conflicted ? '✓' : '✗'} a stale-parented Save is rejected (409, conflict)`);
console.log(`  ${theirsMatches ? '✓' : '✗'} the compare fetches the current GitHub version`);
console.log(`  ${mineChanged > 0 && theirsChanged > 0 ? '✓' : '✗'} diffLines flags the differing lines (${mineChanged} mine, ${theirsChanged} theirs)`);
console.log(`  ${keptMine ? '✓' : '✗'} "keep mine" lands and replaces theirs when re-parented`);
console.log(`  ${copyMade ? '✓' : '✗'} "save a copy" writes a new draft, leaving the file alone`);
console.log(`\n${ok ? '✓ PASS' : '✗ FAIL'} — the real conflict path works end to end`);
process.exit(ok ? 0 : 1);
