// PROTOTYPE live verification (#9) — drives the REAL trackPublish (real gh
// client, real GitHub) through an actual red build on the scratch repo and
// asserts it detects + attributes the failure. This is the end-to-end the
// ticket said had never been run: not a mock, the live path.
//
//   npx tsx prototype/build-failure/verify-track.mts
//
// Breaks the build, tracks it to a terminal event, checks the translation,
// then reverts and confirms green.
import { readFileSync } from 'node:fs';
import { createClient } from '../../src/gh/index.js';
import { trackPublish } from '../../src/finishline/index.js';

const REPO = 'obrien-k/DeadSimpleCMS-scratch';
const token = readFileSync(new URL('../../.scratch-token', import.meta.url), 'utf8').trim();
const gh = createClient({ token, repo: REPO });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const path = '_posts/2026-07-17-verify9.md';
const body = '---\ntitle: Verify 9\n---\n\nAn `{% if x %}` with no endif breaks the build.\n';

console.log('committing the break…');
const head = await gh.getHeadSha();
const { sha } = await gh.commit({
  message: 'PROTOTYPE #9 verify break',
  changes: [{ path, content: body }],
  expectedHeadSha: head,
});
console.log(`break sha ${sha.slice(0, 8)}; tracking via the real trackPublish…\n`);

let last;
for await (const e of trackPublish(
  { gh, fetchSite: fetch.bind(globalThis), sleep },
  { sha, slug: 'verify9', path, front: { title: 'Verify 9' } },
  { pollMs: 5000, maxStatusPolls: 60 },
)) {
  console.log('  event:', JSON.stringify(e));
  last = e;
}

const ok =
  last?.kind === 'build-failed' &&
  last.cause?.mine === true &&
  /'if' tag was never closed/.test(last.cause.problem);
console.log(`\n${ok ? '✓' : '✗'} trackPublish detected + attributed the red build`);
if (ok && last?.kind === 'build-failed') {
  console.log(`  rendered file: ${last.cause!.file}  line: ${last.cause!.line}`);
}

console.log('\nreverting…');
const head2 = await gh.getHeadSha();
const { sha: fixSha } = await gh.commit({
  message: 'PROTOTYPE #9 verify revert',
  deletions: [path],
  expectedHeadSha: head2,
});
// Confirm green via the same check-run path the app now trusts.
for (let i = 0; i < 30; i++) {
  const b = await gh.getBuildState(fixSha);
  if (b.status === 'completed') {
    console.log(`revert build: ${b.conclusion}`);
    break;
  }
  await sleep(6000);
}
process.exit(ok ? 0 : 1);
