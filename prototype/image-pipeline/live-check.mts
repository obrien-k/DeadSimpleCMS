// PROTOTYPE live check (#14) — run by hand against the disposable scratch repo,
// never in CI (no PAT in CI, per the live-api-rig note). Proves the ONE thing
// unit tests can't: my extended commit() puts a real post + a real binary image
// into GitHub in a single commit, and the image bytes survive intact.
//
// The image bytes are the actual output of the browser downscale (captured to
// .resized.json by the Playwright harness), so this exercises the full chain:
// canvas re-encode → Uint8Array → base64 blob → Git Data commit → read back.
//
//   npx tsx prototype/image-pipeline/live-check.mts
//
// Verification reads back through the raw Git Data blob API — an INDEPENDENT
// path from the client's own writer — so a bug shared by both can't hide.
import { readFileSync } from 'node:fs';
import { createClient } from '../../src/gh/index.js';
import { imageFilename, insertionMarkdown, imageDir } from '../../src/image/index.js';

const REPO = 'obrien-k/DeadSimpleCMS-scratch';
const token = readFileSync(new URL('../../.scratch-token', import.meta.url), 'utf8').trim();
const gh = createClient({ token, repo: REPO });

const resized = JSON.parse(readFileSync(new URL('./.resized.json', import.meta.url), 'utf8'));
const bytes = new Uint8Array(Buffer.from(resized.base64, 'base64'));

const raw = (path: string) =>
  fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw' },
  });

// A throwaway dir so this never perturbs the live Pages build; cleaned up below.
const dir = 'tmp-live14';
const uniq = Math.random().toString(36).slice(2, 6);
const imgName = imageFilename('ugly.jpg', uniq);
const imgPath = `${dir}/${imgName}`;
const postPath = `${dir}/post-${uniq}.md`;
const body = `---\ntitle: Live 14\n---\n\n${insertionMarkdown(dir, imgName)}\n`;

console.log(`bytes from browser downscale: ${bytes.length} (${resized.width}×${resized.height})`);
console.log(`inferred dir for a real assets/img site: ${imageDir([{ path: 'assets/img/x.jpg' }]).dir}`);

const head = await gh.getHeadSha();
const { sha } = await gh.commit({
  message: 'PROTOTYPE #14 live check — post + image in one commit',
  changes: [
    { path: postPath, content: body },
    { path: imgPath, content: bytes },
  ],
  expectedHeadSha: head,
});
console.log(`\ncommitted ${sha.slice(0, 8)} — one commit, two files`);

// 1. Both files exist at that commit, and it is genuinely ONE commit.
const commit = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
const touched = commit.files.map((f: { filename: string }) => f.filename).sort();
console.log(`commit touched: ${touched.join(', ')}`);
console.log(`parents: ${commit.parents.length} (expect 1 — fast-forward)`);

// 2. The post is intact text.
const postText = await raw(postPath).then((r) => r.text());
const postOk = postText.includes(`![](/${imgPath})`);

// 3. The image bytes round-trip EXACTLY — the real test of the binary path.
const back = new Uint8Array(await raw(imgPath).then((r) => r.arrayBuffer()));
const bytesOk = back.length === bytes.length && back.every((b, i) => b === bytes[i]);
const isJpeg = back[0] === 0xff && back[1] === 0xd8;

console.log(`\npost markdown references the image: ${postOk ? 'YES' : 'NO'}`);
console.log(`image bytes round-trip exact: ${bytesOk ? 'YES' : 'NO'} (${back.length} B, JPEG SOI=${isJpeg})`);

// Cleanup — scratch is disposable, but leave it tidy.
const head2 = await gh.getHeadSha();
await gh.commit({
  message: 'PROTOTYPE #14 live check — cleanup',
  deletions: [postPath, imgPath],
  expectedHeadSha: head2,
});
console.log(`\ncleaned up (${postPath}, ${imgPath} removed)`);

const pass = postOk && bytesOk && isJpeg && commit.parents.length === 1 && touched.length === 2;
console.log(`\n${pass ? '✓ LIVE CHECK PASSED' : '✗ LIVE CHECK FAILED'}`);
process.exit(pass ? 0 : 1);
