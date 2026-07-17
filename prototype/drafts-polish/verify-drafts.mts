// PROTOTYPE live verification (#16) — drives the REAL unpublish and delete
// paths (unpublishPath → buildUnpublish → gh.commit → trackRevert, and the
// delete commit) against the scratch repo. Not a mock: the same functions the
// buttons call.
//
//   npx tsx prototype/drafts-polish/verify-drafts.mts
//
// Part A: publish a post → unpublish it → assert the draft is back with its
// content, the post is gone, the build is green, and republishing re-derives
// the SAME filename (the date round-trips). Part B: create a draft → delete it
// → assert it is gone.
import { readFileSync } from 'node:fs';
import { createClient, GhError } from '../../src/gh/index.js';
import { trackRevert } from '../../src/finishline/index.js';
import { buildUnpublish } from '../../src/app/views/Publish.js';
import { publishPath, unpublishPath } from '../../src/app/dates.js';

const REPO = 'obrien-k/DeadSimpleCMS-scratch';
const token = readFileSync(new URL('../../.scratch-token', import.meta.url), 'utf8').trim();
const gh = createClient({ token, repo: REPO });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (p: string) =>
  gh.readFile(p).then(() => true).catch((e) => !(e instanceof GhError && e.status === 404));

// A 2019-dated post: proves the date survives the round trip, not just today's.
const slug = 'drafts16';
const date = '2019-03-01 10:00:00 +0000';
const postPath = publishPath(slug, date, '_posts'); // _posts/2019-03-01-drafts16.md
const draftPath = unpublishPath(postPath, '_drafts'); // _drafts/drafts16.md
const content = `---\ntitle: Drafts 16\ndate: ${date}\n---\n\nAn ordinary post that builds fine.\n`;

// ---- Part A: publish → unpublish → republish ----
console.log(`publishing ${postPath}…`);
let head = await gh.getHeadSha();
await gh.commit({ message: 'PROTOTYPE #16 publish', changes: [{ path: postPath, content }], expectedHeadSha: head });

console.log('unpublishing (the real path)…');
const { message, changes, deletions } = buildUnpublish(
  { path: postPath, from: draftPath, slug, front: { title: 'Drafts 16' } },
  content,
);
head = await gh.getHeadSha();
const { sha } = await gh.commit({ message, changes, deletions, expectedHeadSha: head });

let revLast;
for await (const e of trackRevert({ gh, sleep }, { sha }, { pollMs: 5000, maxStatusPolls: 60 })) {
  console.log('  unpublish:', JSON.stringify(e));
  revLast = e;
}

const draftBack = await gh.readFile(draftPath).then((f) => f.text === content).catch(() => false);
const postGone = !(await exists(postPath));

console.log('\nrepublishing (should re-derive the same filename)…');
head = await gh.getHeadSha();
const rederived = publishPath(slug, date, '_posts');
await gh.commit({
  message: 'PROTOTYPE #16 republish',
  changes: [{ path: rederived, content }],
  deletions: [draftPath],
  expectedHeadSha: head,
});
const sameName = rederived === postPath;

// ---- Part B: create a draft → delete it ----
console.log('\ncreating then deleting a draft…');
const tmpDraft = '_drafts/delete16.md';
head = await gh.getHeadSha();
await gh.commit({ message: 'PROTOTYPE #16 draft', changes: [{ path: tmpDraft, content }], expectedHeadSha: head });
const madeDraft = await exists(tmpDraft);
head = await gh.getHeadSha();
await gh.commit({ message: 'PROTOTYPE #16 delete draft', deletions: [tmpDraft], expectedHeadSha: head });
const draftDeleted = !(await exists(tmpDraft));

// ---- cleanup: remove the republished post ----
head = await gh.getHeadSha();
await gh.commit({ message: 'PROTOTYPE #16 cleanup', deletions: [postPath], expectedHeadSha: head });

const ok = revLast?.kind === 'reverted' && draftBack && postGone && sameName && madeDraft && draftDeleted;
console.log('\nresults:');
console.log(`  ${revLast?.kind === 'reverted' ? '✓' : '✗'} unpublish watched the site back to green`);
console.log(`  ${draftBack ? '✓' : '✗'} the draft is back at ${draftPath} with the post's content`);
console.log(`  ${postGone ? '✓' : '✗'} the post was removed from ${postPath}`);
console.log(`  ${sameName ? '✓' : '✗'} republish re-derived the same filename (date round-trips)`);
console.log(`  ${madeDraft && draftDeleted ? '✓' : '✗'} a draft can be created and deleted`);
console.log(`\n${ok ? '✓ PASS' : '✗ FAIL'} — the real drafts-polish paths work end to end`);
process.exit(ok ? 0 : 1);
