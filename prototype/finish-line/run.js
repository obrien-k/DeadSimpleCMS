// PROTOTYPE — throwaway. `TOKEN_FILE=… REPO=owner/name node run.js`
// Run setup.js first. Answers #4: does the finish line actually work?

import { readFileSync } from 'node:fs';
import { Api } from '../git-data-move/api.js';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m';
const ok = (m) => console.log(`  ${G}✓${X} ${m}`);
const bad = (m) => { console.log(`  ${R}✗${X} ${m}`); failures++; };
const note = (m) => console.log(`    ${D}${m}${X}`);
let failures = 0;

const TOKEN = readFileSync(process.env.TOKEN_FILE, 'utf8').trim();
const REPO = process.env.REPO;
const BRANCH = 'main';
const api = new Api(TOKEN, REPO);
const t0 = Date.now();
const secs = (from) => `${((Date.now() - from) / 1000).toFixed(0)}s`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, fn, { timeout = 240000, every = 5000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return { v, ms: Date.now() - start };
    await sleep(every);
  }
  return { v: null, ms: Date.now() - start, timedOut: true };
}

console.log(`\n${'='.repeat(66)}\nFinish-line prototype — ${REPO}\n${'='.repeat(66)}`);

// ---------------------------------------------------------------- preflight
// Q1's discriminator: "no Pages build configured at all" is not a slow run, it
// is a 404 here. One call, before any polling, and it cannot be confused with
// "not registered yet".
console.log(`\n${Y}0. Is Pages even configured? (the 'not registered yet' discriminator)${X}`);
let pages;
try {
  pages = await api.req('GET', `/repos/${REPO}/pages`);
  ok(`GET /pages → 200, build_type=${pages.build_type}, url=${pages.html_url}`);
  note('404 here would mean NO Pages at all — distinct from a run that has not appeared yet');
} catch (e) {
  bad(`GET /pages → ${e.status}. No Pages configured; nothing downstream is meaningful.`);
  process.exit(1);
}
const siteUrl = pages.html_url.replace(/\/$/, '');
const origin = new URL(siteUrl).origin;

// ------------------------------------------------------------------ publish
const stamp = Date.now().toString(36);
// Date the control post YESTERDAY (UTC), not today. `toISOString()` is UTC, so
// "today at 12:00 +0000" is still in the future for most of the UTC day —
// Jekyll's `future: false` then silently drops it and the post never appears.
// This harness fell into exactly the trap it exists to test.
const today = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const slug = `finish-line-${stamp}`;
const postPath = `_posts/${today}-${slug}.md`;
const postUrl = `${siteUrl}/${today.replace(/-/g, '/')}/${slug}.html`;

console.log(`\n${Y}1. Publish a post, then find its build${X}`);
const ref = await api.getRef(BRANCH);
const headCommit = await api.getCommit(ref.object.sha);
const blob = await api.createBlob(
  `---\nlayout: null\ntitle: "Finish line ${stamp}"\ndate: ${today} 00:00:00 +0000\n---\n\nProving the finish line. 🎉 café\n`,
);
const tree = await api.createTree(headCommit.tree.sha, [
  { path: postPath, mode: '100644', type: 'blob', sha: blob.sha },
]);
const commit = await api.createCommit(`Publish: ${slug}`, tree.sha, [ref.object.sha]);
await api.updateRef(BRANCH, commit.sha);
const sha = commit.sha;
const tPublish = Date.now();
ok(`committed ${sha.slice(0, 7)} → ${postPath}`);
note(`expected URL: ${postUrl}`);

// Probe NOW, before the build can land — this is the whole point. The app would
// realistically do this (checking whether a URL is taken), and if Pages caches
// the resulting 404 at the edge, that 404 outlives the build and the finish line
// reports "not live" on a post that is live. Probing after the build proves
// nothing: there is no 404 to go stale.
const preRes = await fetch(postUrl);
const preStatus = preRes.status;
const preCC = preRes.headers.get('cache-control');
note(`pre-build probe: ${preStatus} | cache-control: ${preCC} | age: ${preRes.headers.get('age')}`);

// ------------------------------------------------------- Q1: run appearance
const appear = await until('run appears', async () => {
  const r = await api.req('GET', `/repos/${REPO}/actions/runs?head_sha=${sha}`);
  return r.workflow_runs.length ? r.workflow_runs[0] : null;
}, { timeout: 120000, every: 3000 });

if (!appear.v) {
  bad(`no run for head_sha after ${secs(tPublish)} — cannot track this build`);
  note('this is the gap Q1 asks about: Pages IS configured, but the run never registered');
} else {
  ok(`run appeared after ${(appear.ms / 1000).toFixed(0)}s — "${appear.v.name}" (event=${appear.v.event})`);
  note(`workflow path: ${appear.v.path}`);
  const done = await until('run completes', async () => {
    const r = await api.req('GET', `/repos/${REPO}/actions/runs/${appear.v.id}`);
    return r.status === 'completed' ? r : null;
  }, { timeout: 240000, every: 5000 });
  done.v
    ? (done.v.conclusion === 'success'
        ? ok(`build ${done.v.conclusion} after ${(done.ms / 1000).toFixed(0)}s`)
        : bad(`build ${done.v.conclusion} after ${(done.ms / 1000).toFixed(0)}s`))
    : bad(`build still running after ${(done.ms / 1000).toFixed(0)}s`);
}

// ------------------------------------------- Q3: liveness (+ the cache trap)
// Deliberately probe BEFORE the build lands, to see whether a 404 gets cached
// and then poisons the post-build check. Pages sends cache-control: max-age=600.
console.log(`\n${Y}2. Liveness — does the pre-publish 404 go stale?${X}`);
if (preStatus !== 404) {
  note(`pre-probe was ${preStatus}, not 404 — no stale-cache case to test on this run`);
}

// Race the two side by side: a cache-busted URL is ground truth, a plain URL is
// what a naive check would use. If busted says 200 while plain still says 404,
// the edge cache is lying and cache-busting is mandatory, not hygiene.
const live = await until('post live (cache-busted = ground truth)', async () => {
  const r = await fetch(`${postUrl}?_=${Date.now()}`);
  return r.status === 200 ? r : null;
}, { timeout: 180000, every: 5000 });

if (live.v) {
  ok(`live after ${(live.ms / 1000).toFixed(0)}s from publish → ${postUrl}`);
  const plain = await fetch(postUrl);
  note(`at first-200: plain=${plain.status} (age=${plain.headers.get('age')}) vs busted=200`);
  if (plain.status === 200) {
    ok('plain URL agrees — the pre-publish 404 did NOT go stale');
    if (preStatus === 404) note(`and a real 404 WAS served pre-build (cache-control: ${preCC}), so the case was exercised`);
  } else {
    bad(`STALE ${plain.status} SERVED while the post is live — cache-busting is MANDATORY`);
    const back = await until('plain URL catches up', async () => {
      const r = await fetch(postUrl);
      return r.status === 200 ? r : null;
    }, { timeout: 660000, every: 15000 });
    back.v
      ? note(`plain URL recovered after a further ${(back.ms / 1000).toFixed(0)}s`)
      : note('plain URL still stale after 11min — worse than max-age suggests');
  }
} else {
  bad(`never went live within ${(live.ms / 1000).toFixed(0)}s`);
}

// --------------------------------------------------- Q2: sitemap discovery
console.log(`\n${Y}3. URL discovery via sitemap.xml${X}`);
const sitemapUrl = `${siteUrl}/sitemap.xml`;
const sm = await until('sitemap has post', async () => {
  const r = await fetch(`${sitemapUrl}?_=${Date.now()}`);
  if (r.status !== 200) return null;
  const xml = await r.text();
  return xml.includes(slug) ? xml : null;
}, { timeout: 120000, every: 5000 });

if (sm.v) {
  ok(`sitemap lists the post after ${(sm.ms / 1000).toFixed(0)}s`);
  const m = sm.v.match(new RegExp(`<loc>([^<]*${slug}[^<]*)</loc>`));
  if (m) {
    const declared = m[1];
    note(`sitemap says: ${declared}`);
    const st = await fetch(`${declared}?_=${Date.now()}`).then((r) => r.status).catch(() => 0);
    st === 200
      ? ok('the sitemap URL actually resolves — sitemap-first strategy works')
      : bad(`sitemap URL returns ${st} — the sitemap points at a URL that does not exist`);
    if (declared !== postUrl) note(`differs from our guess (${postUrl}) — sitemap is authoritative`);
  }
} else {
  const st = await fetch(sitemapUrl).then((r) => r.status).catch(() => 0);
  bad(`no sitemap after ${(sm.ms / 1000).toFixed(0)}s (GET sitemap.xml → ${st})`);
  note('this is Q2 fallback territory: no jekyll-sitemap plugin, or url/baseurl unset');
}

// ------------------------------------------------------- Q3: cross-origin
console.log(`\n${Y}4. Cross-origin liveness — is the opaque-response problem real?${X}`);
const corsRes = await fetch(postUrl, { headers: { Origin: 'https://not-this-site.example' } });
const acao = corsRes.headers.get('access-control-allow-origin');
acao === '*'
  ? ok(`Pages sends access-control-allow-origin: * → a normal CORS fetch reads the status`)
  : bad(`no CORS header (got ${acao}) → cross-origin verification needs no-cors and goes opaque`);
note('#4 assumed no-cors + opaque response. Check whether that premise survives.');

// --------------------------------------------------- Q4: the silent traps
console.log(`\n${Y}5. Green build, not live — the traps${X}`);
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const futureSlug = `trap-future-${stamp}`;
const unpubSlug = `trap-unpub-${stamp}`;
const ref2 = await api.getRef(BRANCH);
const hc2 = await api.getCommit(ref2.object.sha);
const [fb, ub] = await Promise.all([
  api.createBlob(`---\nlayout: null\ntitle: "Future ${stamp}"\ndate: ${future} 12:00:00 +0000\n---\n\nShould not be live.\n`),
  api.createBlob(`---\nlayout: null\ntitle: "Unpublished ${stamp}"\ndate: ${today} 12:00:00 +0000\npublished: false\n---\n\nShould not be live.\n`),
]);
const t2 = await api.createTree(hc2.tree.sha, [
  { path: `_posts/${future}-${futureSlug}.md`, mode: '100644', type: 'blob', sha: fb.sha },
  { path: `_posts/${today}-${unpubSlug}.md`, mode: '100644', type: 'blob', sha: ub.sha },
]);
const c2 = await api.createCommit('Traps: future-dated and published:false', t2.sha, [ref2.object.sha]);
await api.updateRef(BRANCH, c2.sha);
ok(`committed traps ${c2.sha.slice(0, 7)}`);

const run2 = await until('trap build', async () => {
  const r = await api.req('GET', `/repos/${REPO}/actions/runs?head_sha=${c2.sha}`);
  const run = r.workflow_runs[0];
  return run && run.status === 'completed' ? run : null;
}, { timeout: 240000, every: 5000 });

if (run2.v) {
  run2.v.conclusion === 'success'
    ? ok(`build ${run2.v.conclusion} — the build is GREEN, which is the whole trap`)
    : bad(`build ${run2.v.conclusion} — expected success`);
  await sleep(10000);
  for (const [label, s, d] of [['future-dated', futureSlug, future], ['published:false', unpubSlug, today]]) {
    const u = `${siteUrl}/${d.replace(/-/g, '/')}/${s}.html`;
    const st = await fetch(`${u}?_=${Date.now()}`).then((r) => r.status).catch(() => 0);
    st === 404
      ? ok(`${label} → ${st}, correctly NOT live despite a green build`)
      : bad(`${label} → ${st}, expected 404 (Jekyll config may differ from assumption)`);
  }
  const smx = await fetch(`${sitemapUrl}?_=${Date.now()}`).then((r) => r.ok ? r.text() : '').catch(() => '');
  const inMap = [futureSlug, unpubSlug].filter((s) => smx.includes(s));
  inMap.length === 0
    ? ok('neither trap appears in sitemap.xml → sitemap absence IS the detection signal')
    : bad(`sitemap lists trap(s): ${inMap.join(', ')} — sitemap cannot be trusted to mean "live"`);
} else {
  bad('trap build never completed');
}

console.log(`\n${'='.repeat(66)}`);
console.log(failures ? `${R}${failures} failure(s)${X}` : `${G}all checks passed${X}`);
console.log(`${D}total API calls: ${api.calls} | wall clock: ${secs(t0)}${X}\n`);
