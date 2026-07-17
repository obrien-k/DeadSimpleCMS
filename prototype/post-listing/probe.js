// PROTOTYPE — throwaway. Answers #5: how are posts listed, and at what scale?
// See NOTES.md.
//
//   TOKEN_FILE=/path/to/token REPO=owner/scratch node probe.js
//
// Read-only. Never prints the token — kind and length only.
//
// The claim under test: ONE GraphQL query returns every post's filename, blob
// oid, and full text, so the list never needs a per-post read. Blob oids are
// content hashes, which makes an oid->title cache self-invalidating.
//
// Uses plain fetch — no Octokit, no GraphQL client — because the real app is a
// static page with a ~100 kB budget and would do exactly this.

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const TOKEN = readFileSync(process.env.TOKEN_FILE, 'utf8').trim();
const REPO = process.env.REPO;
const [OWNER, NAME] = REPO.split('/');

// Scale fixture: a real, large, public Jekyll site. Read-only third party — the
// scratch repo only has ~13 posts, and committing 200 to it just to measure
// would pollute a repo other prototypes reset.
const SCALE_REPO = process.env.SCALE_REPO ?? 'jekyll/jekyll';
const SCALE_PATH = process.env.SCALE_PATH ?? 'docs/_posts';

const D = '\x1b[2m', G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', X = '\x1b[0m';
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

// Returns the raw body text too — response size is one of the findings.
async function graphql(query, { auth = true } = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, body: text, json: data };
}

const listQuery = (owner, name, path, withText) => `
{ dir: repository(owner: "${owner}", name: "${name}") {
    object(expression: "HEAD:${path}") { ... on Tree {
      entries { name oid ${withText ? 'object { ... on Blob { byteSize isBinary isTruncated text } }' : ''} } } } }
  rateLimit { cost remaining } }`;

console.log(`\n${'='.repeat(70)}\n#5 post-listing probe\n${'='.repeat(70)}`);
console.log(`  token:  ${TOKEN.startsWith('github_pat_') ? 'fine-grained' : TOKEN.startsWith('ghp_') ? 'CLASSIC' : 'unknown'} (${TOKEN.length} chars)`);
console.log(`  target: ${REPO}   scale: ${SCALE_REPO}/${SCALE_PATH}`);

const summary = {};

// --- 1. THE BLOCKING QUESTION -----------------------------------------------
// Does a fine-grained PAT authenticate to GraphQL at all? Nothing else matters
// if this fails: the whole decision falls back to REST + lazy titles.
console.log(`\n${Y}1. Fine-grained PAT against GraphQL${X}`);
{
  const r = await graphql(`{ viewer { login } rateLimit { limit remaining } }`);
  const ok = r.status === 200 && r.json?.data?.viewer?.login;
  summary.patWorksOnGraphql = !!ok;
  console.log(`   viewer query -> ${r.status} ${ok ? `${G}authenticated${X}` : `${R}FAILED${X}`}`);
  if (ok) console.log(`   ${D}rate limit: ${r.json.data.rateLimit.remaining}/${r.json.data.rateLimit.limit} (points, separate from REST's 5000 req/hr)${X}`);
  else console.log(`   ${R}${r.body.slice(0, 300)}${X}`);
}

// --- 2. THE PUBLIC-REPO FALSE PASS ------------------------------------------
// This trap has now bitten #7, #4, and nearly this ticket. The scratch repo is
// PUBLIC, so a 200 here says nothing about whether the token is scoped to it.
// GraphQL is only *partly* immune: unlike REST, it rejects anonymous callers
// even for public data — so 200 does prove authentication, just never scope.
console.log(`\n${Y}2. Unauthenticated GraphQL on the same public repo${X}`);
{
  const r = await graphql(listQuery(OWNER, NAME, '_posts', false), { auth: false });
  const rejected = r.status === 401 || r.status === 403;
  summary.anonGraphqlStatus = r.status;
  console.log(`   anonymous -> ${r.status} ${rejected ? `${G}rejected — auth is required even for public repos${X}` : `${R}served anonymously${X}`}`);
  console.log(`   ${D}=> a 200 with the PAT proves the token authenticated, NOT that it is scoped here.${X}`);
  console.log(`   ${D}   Any valid token, scoped anywhere, reads a public repo's contents.${X}`);
}

// --- 3. THE LISTING QUERY ---------------------------------------------------
console.log(`\n${Y}3. One query, both directories, on ${REPO}${X}`);
{
  const q = `
{ posts: repository(owner: "${OWNER}", name: "${NAME}") {
    object(expression: "HEAD:_posts") { ... on Tree {
      entries { name oid object { ... on Blob { byteSize isBinary isTruncated text } } } } } }
  drafts: repository(owner: "${OWNER}", name: "${NAME}") {
    object(expression: "HEAD:_drafts") { ... on Tree {
      entries { name oid object { ... on Blob { byteSize isBinary isTruncated text } } } } } }
  rateLimit { cost remaining } }`;
  const r = await graphql(q);
  const posts = r.json?.data?.posts?.object;
  const drafts = r.json?.data?.drafts?.object;
  console.log(`   status ${r.status}, cost ${r.json?.data?.rateLimit?.cost}`);
  console.log(`   _posts:  ${posts ? `${posts.entries.length} entries` : `${D}object: null${X}`}`);
  console.log(`   _drafts: ${drafts ? `${drafts.entries.length} entries` : `${D}object: null — a MISSING DIRECTORY IS NOT AN ERROR${X}`}`);
  summary.missingDirIsNull = drafts === null || drafts === undefined;

  // Titles come out of the text we already have. No second call.
  const titles = (posts?.entries ?? []).slice(0, 3).map((e) => {
    const m = /^---\n([\s\S]*?)\n---/.exec(e.object?.text ?? '');
    const t = m && /^title:\s*(.+)$/m.exec(m[1]);
    return `${e.oid.slice(0, 7)} ${e.name} -> ${t ? t[1] : '(no title)'}`;
  });
  console.log(`   ${D}titles parsed from the same response:${X}`);
  titles.forEach((t) => console.log(`     ${D}${t}${X}`));
}

// --- 4. SCALE ---------------------------------------------------------------
// Tree.entries is NOT a Relay connection: no first/after, no pagination. The
// response is whatever the directory holds. Measure it on a real large site.
console.log(`\n${Y}4. Scale — ${SCALE_REPO}/${SCALE_PATH} (no pagination available)${X}`);
{
  const [so, sn] = SCALE_REPO.split('/');
  const withText = await graphql(listQuery(so, sn, SCALE_PATH, true));
  const namesOnly = await graphql(listQuery(so, sn, SCALE_PATH, false));
  const entries = withText.json?.data?.dir?.object?.entries ?? [];

  const full = withText.body.length;
  const lean = namesOnly.body.length;
  summary.posts = entries.length;
  summary.fullBytes = full;
  summary.leanBytes = lean;

  console.log(`   entries: ${entries.length}`);
  console.log(`   cost:    ${withText.json?.data?.rateLimit?.cost} (with text) / ${namesOnly.json?.data?.rateLimit?.cost} (names+oids only)`);
  console.log(`   full response (name+oid+text): ${kb(full)} raw, ${kb(gzipSync(Buffer.from(withText.body)).length)} gzip`);
  console.log(`   lean response (name+oid only): ${kb(lean)} raw, ${kb(gzipSync(Buffer.from(namesOnly.body)).length)} gzip`);
  console.log(`   ${D}per post: ${(full / Math.max(entries.length, 1)).toFixed(0)} B full, ${(lean / Math.max(entries.length, 1)).toFixed(0)} B lean${X}`);
  console.log(`   ${D}extrapolated to 200 posts: ${kb((full / Math.max(entries.length, 1)) * 200)} full, ${kb((lean / Math.max(entries.length, 1)) * 200)} lean${X}`);

  const binary = entries.filter((e) => e.object?.isBinary).length;
  const truncated = entries.filter((e) => e.object?.isTruncated).length;
  const nullText = entries.filter((e) => e.object && e.object.text === null).length;
  summary.binary = binary; summary.truncated = truncated; summary.nullText = nullText;
  console.log(`   isBinary: ${binary}, isTruncated: ${truncated}, text===null: ${nullText}`);
}

// --- 5. THE DEGRADATION CASE ------------------------------------------------
// Blob.text is null for anything GraphQL calls binary. The scratch repo holds
// no binary, so this reads a directory of real images to see the null in the
// wild: the list must degrade to a filename-derived title, not break.
console.log(`\n${Y}5. Does Blob.text ever go null? (binary / truncated)${X}`);
{
  const r = await graphql(`
{ repository(owner: "jekyll", name: "jekyll") {
    object(expression: "HEAD:docs/img") { ... on Tree {
      entries { name type object { ... on Blob { byteSize isBinary isTruncated text } } } } } }
  rateLimit { cost } }`);
  const entries = (r.json?.data?.repository?.object?.entries ?? [])
    .filter((e) => e.type === 'blob').slice(0, 5);
  for (const e of entries) {
    const o = e.object ?? {};
    const flag = o.isBinary ? `${R}isBinary${X}` : o.isTruncated ? `${Y}isTruncated${X}` : `${G}text ok${X}`;
    console.log(`   ${e.name.padEnd(24)} ${String(o.byteSize).padStart(7)} B  ${flag}  text=${o.text === null ? `${R}null${X}` : `${o.text?.length ?? 0} chars`}`);
  }
  summary.binaryTextIsNull = entries.some((e) => e.object?.isBinary && e.object.text === null);
  console.log(`   ${D}=> isBinary is a flag on the SAME response, so a null title is explainable, not a mystery.${X}`);
}

// --- 6. FETCH ONLY THE CACHE MISSES -----------------------------------------
// §4 makes the naive "always fetch text" query look bad: 17x the bytes to
// refill a cache that is almost always warm. The fix is to address blobs by oid
// directly and alias one per miss, so the second call carries only what changed.
console.log(`\n${Y}6. Aliased fetch by oid — does it work, and at what cost?${X}`);
{
  const lean = await graphql(listQuery(OWNER, NAME, '_posts', false));
  const oids = (lean.json?.data?.dir?.object?.entries ?? []).slice(0, 3).map((e) => e.oid);

  const aliases = oids.map((oid, i) => `b${i}: object(oid: "${oid}") { ... on Blob { byteSize text } }`).join('\n    ');
  const r = await graphql(`
{ repository(owner: "${OWNER}", name: "${NAME}") {
    ${aliases} }
  rateLimit { cost remaining } }`);

  const got = Object.entries(r.json?.data?.repository ?? {});
  summary.oidFetchWorks = got.length === oids.length && got.every(([, v]) => typeof v?.text === 'string');
  summary.oidFetchCost = r.json?.data?.rateLimit?.cost;
  console.log(`   requested ${oids.length} blobs by oid -> ${r.status}, cost ${r.json?.data?.rateLimit?.cost}, ${kb(r.body.length)}`);
  got.forEach(([alias, v], i) => console.log(`   ${D}${alias} ${oids[i].slice(0, 7)} -> ${v?.text ? `${v.byteSize} B, text ok` : 'NO TEXT'}${X}`));

  // Cold start aliases every post at once. If that hit a node limit the whole
  // scheme would need chunking, so measure it at real scale rather than assume.
  const [so, sn] = SCALE_REPO.split('/');
  const bulkLean = await graphql(listQuery(so, sn, SCALE_PATH, false));
  const allOids = (bulkLean.json?.data?.dir?.object?.entries ?? []).map((e) => e.oid);
  const bulkAliases = allOids.map((oid, i) => `b${i}: object(oid: "${oid}") { ... on Blob { text } }`).join('\n    ');
  const bulk = await graphql(`
{ repository(owner: "${so}", name: "${sn}") {
    ${bulkAliases} }
  rateLimit { cost nodeCount } }`);
  const bulkOk = Object.values(bulk.json?.data?.repository ?? {}).filter((v) => typeof v?.text === 'string').length;
  summary.bulkAliases = allOids.length;
  summary.bulkReturned = bulkOk;
  console.log(`   ${G}cold start:${X} ${allOids.length} aliases in one query -> ${bulkOk} blobs, cost ${bulk.json?.data?.rateLimit?.cost}, nodeCount ${bulk.json?.data?.rateLimit?.nodeCount}, query ${kb(bulkAliases.length)}`);
  console.log(`   ${D}=> steady state is the lean query alone; misses cost one extra call, sized to the diff.${X}`);
}

console.log(`\n${'='.repeat(70)}`);
console.log(`SUMMARY ${JSON.stringify(summary)}`);
console.log();
