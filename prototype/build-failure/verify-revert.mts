// PROTOTYPE live verification (#9, revert half) — drives the REAL undo path
// (buildUnpublish → gh.commit → trackRevert) through an actual red build on the
// scratch repo. Not a mock: the same code the Undo button runs.
//
//   npx tsx prototype/build-failure/verify-revert.mts
//
// Publishes a post that breaks the build, confirms trackPublish blames it
// (mine:true), then undoes it and asserts: the post is gone, the draft is back
// with its content, and the site builds green again.
import { readFileSync } from 'node:fs';
import { createClient, GhError } from '../../src/gh/index.js';
import { trackPublish, trackRevert } from '../../src/finishline/index.js';
import { buildUnpublish } from '../../src/app/views/Publish.js';

const REPO = 'obrien-k/DeadSimpleCMS-scratch';
const token = readFileSync(new URL('../../.scratch-token', import.meta.url), 'utf8').trim();
const gh = createClient({ token, repo: REPO });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const postPath = '_posts/2026-07-17-revert9.md';
const draftPath = '_drafts/revert9.md';
const slug = 'revert9';
const front = { title: 'Revert 9' };
const body = '---\ntitle: Revert 9\n---\n\nAn `{% if x %}` with no endif breaks the build.\n';

// 1. Publish the break (a post, as the move would leave it).
console.log('publishing the break…');
const head = await gh.getHeadSha();
const { sha } = await gh.commit({
  message: 'PROTOTYPE #9 revert: publish break',
  changes: [{ path: postPath, content: body }],
  expectedHeadSha: head,
});
console.log(`break sha ${sha.slice(0, 8)}; tracking the publish…\n`);

let last;
for await (const e of trackPublish(
  { gh, fetchSite: fetch.bind(globalThis), sleep },
  { sha, slug, path: postPath, from: draftPath, front },
  { pollMs: 5000, maxStatusPolls: 60 },
)) {
  console.log('  publish:', JSON.stringify(e));
  last = e;
}
const blamed = last?.kind === 'build-failed' && last.cause?.mine === true;
console.log(`\n${blamed ? '✓' : '✗'} publish was blamed on the post (mine:true)`);

// 2. Undo — the exact path the button runs.
console.log('\nundoing…');
const file = await gh.readFile(postPath);
const head2 = await gh.getHeadSha();
const { message, changes, deletions } = buildUnpublish({ path: postPath, from: draftPath, slug, front }, file.text);
const { sha: revertSha } = await gh.commit({ message, changes, deletions, expectedHeadSha: head2 });
console.log(`undo sha ${revertSha.slice(0, 8)}; tracking the revert…\n`);

let revLast;
for await (const e of trackRevert({ gh, sleep }, { sha: revertSha }, { pollMs: 5000, maxStatusPolls: 60 })) {
  console.log('  revert:', JSON.stringify(e));
  revLast = e;
}

// 3. Assert the state the writer would find.
const draftBack = await gh.readFile(draftPath).then((f) => f.text === file.text).catch(() => false);
const postGone = await gh
  .readFile(postPath)
  .then(() => false)
  .catch((e) => e instanceof GhError && e.status === 404);

const ok = blamed && revLast?.kind === 'reverted' && draftBack && postGone;
console.log('\nresults:');
console.log(`  ${revLast?.kind === 'reverted' ? '✓' : '✗'} trackRevert reported the site green again`);
console.log(`  ${draftBack ? '✓' : '✗'} the draft is back at ${draftPath} with the post's content`);
console.log(`  ${postGone ? '✓' : '✗'} the post is gone from ${postPath}`);

// 4. Leave the scratch repo clean.
const head3 = await gh.getHeadSha();
await gh.commit({ message: 'PROTOTYPE #9 revert: cleanup', deletions: [draftPath], expectedHeadSha: head3 });
console.log('\ncleaned up the draft.');
console.log(`\n${ok ? '✓ PASS' : '✗ FAIL'} — the real undo path recovered the build`);
process.exit(ok ? 0 : 1);
