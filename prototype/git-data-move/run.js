// PROTOTYPE — throwaway. `node run.js` (needs TOKEN_FILE + REPO env or defaults).

import { readFileSync } from 'node:fs';
import { Api, atomicMove } from './api.js';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m';
const ok = (m) => console.log(`  ${G}✓${X} ${m}`);
const bad = (m) => { console.log(`  ${R}✗${X} ${m}`); failures++; };
const note = (m) => console.log(`    ${D}${m}${X}`);
let failures = 0;

const TOKEN = readFileSync(process.env.TOKEN_FILE, 'utf8').trim();
const REPO = process.env.REPO;
const BRANCH = 'main';
const api = new Api(TOKEN, REPO);

console.log(`\n${'='.repeat(64)}\nGit Data API prototype — ${REPO}\n${'='.repeat(64)}`);

// Reset the scratch repo to its seed state so runs are idempotent. Uses the
// same Git Data machinery under test, which is fine: a broken reset fails loudly
// in check 2 rather than faking a pass.
console.log(`\n${D}resetting scratch repo to seed state…${X}`);
{
  const ref = await api.getRef(BRANCH);
  const headCommit = await api.getCommit(ref.object.sha);
  const tree = await api.getTree(ref.object.sha);
  const seedDraft = '---\nlayout: post\ntitle: "My First Draft"   # keep this comment\ntags: [scratch, testing]\n---\n\nDraft body with a 🎉 emoji and café.\n';
  const keep = new Set(['_config.yml', '_posts/2026-01-01-existing-post.md', '_drafts/my-first-draft.md']);
  const deletions = tree.tree
    .filter((e) => e.type === 'blob' && !keep.has(e.path))
    .map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: null }));
  const blob = await api.createBlob(seedDraft);
  const newTree = await api.createTree(headCommit.tree.sha, [
    { path: '_drafts/my-first-draft.md', mode: '100644', type: 'blob', sha: blob.sha },
    ...deletions,
  ]);
  const c = await api.createCommit('Reset to seed state', newTree.sha, [ref.object.sha]);
  await api.updateRef(BRANCH, c.sha);
  console.log(`${D}  reset to ${c.sha.slice(0, 7)} (${deletions.length} stale file(s) removed)${X}`);
}

// ---------------------------------------------------------------- permissions
console.log(`\n${Y}1. Can a fine-grained PAT reach the Git Data endpoints?${X}`);
try {
  const ref = await api.getRef(BRANCH);
  ok(`git/ref read → HEAD ${ref.object.sha.slice(0, 7)}`);
} catch (e) {
  bad(`git/ref read failed: ${e.message}`);
  console.log(`\n${R}Cannot continue without read access.${X}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- atomic move
console.log(`\n${Y}2. Is draft → post genuinely ONE commit?${X}`);
const from = '_drafts/my-first-draft.md';
const to = '_posts/2026-07-16-my-first-draft.md';
let moveCommit;
try {
  const before = await api.getRef(BRANCH);
  const original = await (async () => {
    const t = await api.getTree(before.object.sha);
    const entry = t.tree.find((e) => e.path === from);
    return entry ? api.getBlobText(entry.sha) : null;
  })();
  if (original === null) { bad(`fixture ${from} not found — repo already mutated?`); }

  const callsBefore = api.calls;
  moveCommit = await atomicMove(api, BRANCH, {
    from, to,
    content: original.replace('My First Draft', 'My First Draft (published)'),
    message: 'Publish: my-first-draft',
    expectedHeadSha: before.object.sha,
  });
  ok(`committed ${moveCommit.sha.slice(0, 7)} in ${api.calls - callsBefore} API calls`);

  // The real assertion: ONE commit that carries both sides of the move.
  //
  // GitHub's rename detection collapses the add+delete into a single entry with
  // status "renamed" and previous_filename set. That is the *strongest* pass:
  // rename detection only fires within a single commit, so seeing it proves
  // there was never an intermediate state with two copies of the post.
  const detail = await api.req('GET', `/repos/${REPO}/commits/${moveCommit.sha}`);
  const renamed = detail.files.find((f) => f.filename === to && f.status === 'renamed');
  const split = detail.files.find((f) => f.filename === to) && detail.files.find((f) => f.filename === from);

  if (detail.parents.length !== 1) {
    bad(`expected 1 parent, got ${detail.parents.length}`);
  } else if (renamed) {
    ok(`one commit, reported as a rename: ${renamed.previous_filename} → ${renamed.filename}`);
    note('rename detection only fires within one commit — atomicity confirmed');
  } else if (split) {
    ok('one commit carrying both the add and the delete');
  } else {
    bad(`neither rename nor add+delete: ${JSON.stringify(detail.files.map((f) => [f.filename, f.status]))}`);
  }

  // And the draft must actually be gone from the tree.
  const after = await api.getTree(moveCommit.sha);
  const stillThere = after.tree.some((e) => e.path === from);
  stillThere ? bad(`${from} still present in tree — not a move`) : ok(`${from} gone from tree`);
} catch (e) {
  bad(`atomic move failed: ${e.message}`);
  if (e.status === 403) note('403 → fine-grained PAT may lack contents:write on this repo');
}

// ------------------------------------------------------------------- unicode
console.log(`\n${Y}3. Does unicode survive the base64 round-trip?${X}`);
try {
  const t = await api.getTree(moveCommit.sha);
  const entry = t.tree.find((e) => e.path === to);
  const text = await api.getBlobText(entry.sha);
  const hasEmoji = text.includes('🎉'), hasAccent = text.includes('café');
  hasEmoji && hasAccent
    ? ok('🎉 and café intact through TextEncoder → base64 → GitHub → base64 → TextDecoder')
    : bad(`mangled: emoji=${hasEmoji} accent=${hasAccent}`);
} catch (e) {
  bad(`unicode check failed: ${e.message}`);
}

// ------------------------------------------------------- multi-file one commit
console.log(`\n${Y}4. Can image + post land in ONE commit (one build)?${X}`);
try {
  const ref = await api.getRef(BRANCH);
  const headCommit = await api.getCommit(ref.object.sha);
  const [imgBlob, postBlob] = await Promise.all([
    api.createBlob('fake-png-bytes'),
    api.createBlob('---\nlayout: post\ntitle: "With Image"\n---\n\n![alt](/assets/img/cover.png)\n'),
  ]);
  const tree = await api.createTree(headCommit.tree.sha, [
    { path: 'assets/img/cover.png', mode: '100644', type: 'blob', sha: imgBlob.sha },
    { path: '_posts/2026-07-16-with-image.md', mode: '100644', type: 'blob', sha: postBlob.sha },
  ]);
  const c = await api.createCommit('Add post with image', tree.sha, [ref.object.sha]);
  await api.updateRef(BRANCH, c.sha);
  const detail = await api.req('GET', `/repos/${REPO}/commits/${c.sha}`);
  detail.files.length === 2
    ? ok(`2 files, 1 commit → 1 Pages build (${detail.files.map((f) => f.filename).join(', ')})`)
    : bad(`expected 2 files, got ${detail.files.length}`);
} catch (e) {
  bad(`multi-file commit failed: ${e.message}`);
}

// -------------------------------------------------------------- CAS conflict
console.log(`\n${Y}5. Does a concurrent edit get caught, not clobbered?${X}`);
try {
  const stale = (await api.getRef(BRANCH)).object.sha; // what "our editor" read

  // Someone else commits in the meantime.
  const headCommit = await api.getCommit(stale);
  const blob = await api.createBlob('---\nlayout: post\ntitle: "Someone Else"\n---\n\nRace.\n');
  const tree = await api.createTree(headCommit.tree.sha, [
    { path: '_posts/2026-07-16-someone-else.md', mode: '100644', type: 'blob', sha: blob.sha },
  ]);
  const theirs = await api.createCommit('Concurrent edit', tree.sha, [stale]);
  await api.updateRef(BRANCH, theirs.sha);
  note(`someone else moved HEAD to ${theirs.sha.slice(0, 7)}`);

  // Client-side guard: we re-read HEAD and notice it moved.
  try {
    await atomicMove(api, BRANCH, {
      from: '_posts/2026-07-16-with-image.md',
      to: '_posts/2026-07-16-with-image.md',
      content: 'clobbered\n',
      message: 'Should not land',
      expectedHeadSha: stale,
    });
    bad('client-side guard did NOT catch the stale HEAD');
  } catch (e) {
    e.conflict ? ok('client-side guard caught it before writing') : bad(`wrong error: ${e.message}`);
  }

  // Server-side guard: force a non-fast-forward ref update.
  const b2 = await api.createBlob('clobber\n');
  const staleCommit = await api.getCommit(stale);
  const t2 = await api.createTree(staleCommit.tree.sha, [
    { path: '_posts/2026-07-16-clobber.md', mode: '100644', type: 'blob', sha: b2.sha },
  ]);
  const c2 = await api.createCommit('Built on stale parent', t2.sha, [stale]);
  try {
    await api.updateRef(BRANCH, c2.sha, false); // force:false
    bad('server ACCEPTED a non-fast-forward update — no server-side CAS!');
    note('the client-side guard is then the ONLY protection');
  } catch (e) {
    ok(`server rejected non-fast-forward: ${e.status} ${e.data?.message ?? ''}`);
  }
} catch (e) {
  bad(`conflict test failed: ${e.message}`);
}

console.log(`\n${'='.repeat(64)}`);
console.log(failures ? `${R}${failures} failure(s)${X}` : `${G}all checks passed${X}`);
console.log(`${D}total API calls: ${api.calls}${X}\n`);
