// PROTOTYPE — throwaway. `TOKEN_FILE=… TARGET=owner/repo node probe.js`
//
// READ-ONLY. Every call is a GET; this probe never writes to anything. Safe to
// point at real repos. It never prints the token, only its kind and length.
//
// Run it TWICE and diff the summaries:
//   token A — scoped to TARGET only   (expected: the good case)
//   token B — scoped to All repositories, Metadata:read only (the over-scoped case)
// A check that cannot tell A from B is not a scope check.

import { readFileSync } from 'node:fs';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m';
const ok = (m) => console.log(`  ${G}✓${X} ${m}`);
const bad = (m) => console.log(`  ${R}✗${X} ${m}`);
const note = (m) => console.log(`    ${D}${m}${X}`);

const TOKEN = readFileSync(process.env.TOKEN_FILE, 'utf8').trim();
const TARGET = process.env.TARGET;
if (!TARGET) { console.error('TARGET=owner/repo required'); process.exit(1); }

let calls = 0;
async function get(path) {
  calls++;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  return {
    status: res.status,
    headers: res.headers,
    body: res.status === 204 ? null : await res.json().catch(() => null),
  };
}

const summary = {};
console.log(`\n${'='.repeat(66)}\nToken scope probe — target ${TARGET}\n${'='.repeat(66)}`);

// ------------------------------------------------------------- 1. token prefix
// The only check costing nothing and needing no network. A classic PAT is
// all-repositories by construction, so the prefix alone convicts it.
console.log(`\n${Y}1. Token kind (offline, free)${X}`);
const kind = TOKEN.startsWith('github_pat_') ? 'fine-grained'
  : TOKEN.startsWith('ghp_') ? 'classic'
  : TOKEN.startsWith('gho_') || TOKEN.startsWith('ghu_') || TOKEN.startsWith('ghs_') ? 'oauth/app'
  : 'unrecognized';
summary.kind = kind;
console.log(`  kind: ${Y}${kind}${X} ${D}(${TOKEN.length} chars)${X}`);
if (kind === 'classic') bad('classic → all-repositories BY CONSTRUCTION. Over-scope proven, zero API calls.');
if (kind === 'fine-grained') ok('fine-grained → prefix cannot reveal breadth. The rest is the real question.');

// ------------------------------------------------------- 2. expiry, from a header
// Free on every response — no dedicated call. Lets the app warn BEFORE the 401
// rather than reacting to it.
console.log(`\n${Y}2. Expiry (free header on every response)${X}`);
const target = await get(`/repos/${TARGET}`);
const exp = target.headers.get('github-authentication-token-expiration');
summary.expiry = exp ?? 'none';
if (exp) {
  const days = Math.round((new Date(exp.replace(' UTC', 'Z').replace(' ', 'T')) - Date.now()) / 86400000);
  ok(`github-authentication-token-expiration: ${exp} ${D}(~${days}d)${X}`);
} else {
  note('no expiry header — non-expiring token, or not a PAT');
}

// --------------------------------------------- 3. permissions on target (candidate)
// The candidate #7's comment proposed. To be a scope oracle it MUST differ
// between token A and token B. Prediction: identical, because it reports the
// USER's role on the repo, not the token's grant.
console.log(`\n${Y}3. GET /repos/{target} → permissions field${X}`);
if (target.status !== 200) {
  bad(`target unreachable: ${target.status} — fix TARGET or token before trusting anything below`);
  process.exit(1);
}
summary.targetPrivate = target.body.private;
summary.permissions = JSON.stringify(target.body.permissions);
ok(`${target.status} — target visibility=${target.body.private ? 'private' : 'PUBLIC'}`);
console.log(`  ${D}permissions: ${summary.permissions}${X}`);
note('if identical across A and B ⇒ NOT a scope oracle');

// ---------------------------------------------------------- 4. THE ORACLE
// A public repo can never be a detector: everyone reads public repos, so 200
// proves nothing. Only a PRIVATE repo is a tripwire — reaching one requires a
// grant. #2 said /user/repos "ignores scoping entirely"; that holds for public
// repos but NOT for private ones, which appear only if the token can reach them.
console.log(`\n${Y}4. Private repos visible to this token — the oracle${X}`);
const priv = [];
for (let page = 1; page <= 10; page++) {
  const r = await get(`/user/repos?per_page=100&page=${page}&visibility=private&affiliation=owner,collaborator,organization_member`);
  if (r.status !== 200 || !Array.isArray(r.body) || r.body.length === 0) break;
  priv.push(...r.body);
  if (r.body.length < 100) break;
}
const strangers = priv.filter((r) => r.full_name !== TARGET);
summary.privateVisible = priv.length;
summary.strangers = strangers.length;
console.log(`  private repos visible: ${Y}${priv.length}${X} (${strangers.length} not the target)`);
for (const s of strangers.slice(0, 5)) bad(`reaches private stranger: ${s.full_name}`);
if (strangers.length > 0) {
  console.log(`\n  ${R}VERDICT: OVER-SCOPED — proven. Token reaches ${strangers.length} private repo(s) it has no business seeing.${X}`);
} else {
  console.log(`\n  ${G}VERDICT: no over-scope detected on the private axis.${X}`);
  note('NOT proof of correct scope — one-sided. Zero is also what you get when');
  note('the account HAS no private repos (no tripwire ⇒ no signal, ever).');
}

// -------------------------------------------------- 5. the public false-pass trap
console.log(`\n${Y}5. Public repos — why they cannot be detectors${X}`);
const pub = await get('/user/repos?per_page=100&visibility=public');
const pubOther = (Array.isArray(pub.body) ? pub.body : []).filter((r) => r.full_name !== TARGET);
summary.publicListed = pubOther.length;
note(`${pubOther.length} public non-target repos listed by a token scoped to one repo`);
if (pubOther.length) {
  const r = await get(`/repos/${pubOther[0].full_name}`);
  note(`${pubOther[0].full_name} → ${r.status} — public repos answer ANY token. Proves nothing.`);
}

// --------------------------------------------------------------------- summary
console.log(`\n${'='.repeat(66)}\n${Y}SUMMARY — paste this line for A/B comparison${X}`);
console.log(JSON.stringify(summary));
console.log(`${D}total API calls: ${calls} (all GETs, nothing written)${X}\n`);
