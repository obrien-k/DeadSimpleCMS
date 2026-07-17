// PROTOTYPE (#9) — run by hand against the disposable scratch repo. The one
// question src/finishline can't answer from a fake: what does GitHub actually
// report on a RED Pages build, and does it name a file or line the CMS could
// translate? Everything downstream (#9's vocabulary, attribution, revert)
// depends on what is really in that payload.
//
//   npx tsx prototype/build-failure/observe.mts [break]
//     break = liquid-unclosed (default) | liquid-badinclude | yaml-broken
//
// Breaking the build does NOT take the site down: Pages keeps serving the last
// good build, so the live URL stays up while the new build is red — which is
// itself part of #9's "your previous posts are unaffected". The script reverts
// its own break and waits for green to return, answering the revert-follow-
// through sub-question too.
import { readFileSync } from 'node:fs';
import { createClient } from '../../src/gh/index.js';

const REPO = 'obrien-k/DeadSimpleCMS-scratch';
const token = readFileSync(new URL('../../.scratch-token', import.meta.url), 'utf8').trim();
const gh = createClient({ token, repo: REPO });
const api = (path: string) =>
  fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  }).then((r) => r.json());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Three ways a git-averse writer could redden the build. The first two are pure
// body text the CMS never inspects; the third is the design's headline example,
// reachable only by hand-editing front matter outside the CMS (the control).
const BREAKS: Record<string, { file: string; content: string; why: string }> = {
  'liquid-unclosed': {
    file: '_posts/2026-07-17-break9.md',
    content: '---\ntitle: Break 9\n---\n\nAn `{% if x %}` with no endif is a syntax error.\n',
    why: 'unclosed Liquid tag in the body — pure CMS use, no git',
  },
  'liquid-badinclude': {
    file: '_posts/2026-07-17-break9.md',
    content: '---\ntitle: Break 9\n---\n\n{% include no-such-file-xyz.html %}\n',
    why: 'include of a missing file from the body — pure CMS use, no git',
  },
  'yaml-broken': {
    file: '_posts/2026-07-17-break9.md',
    content: '---\ntitle: "unterminated\ndate: 2026-07-17\n---\n\nBody.\n',
    why: 'stray quote in front matter — the design example, only reachable by hand-edit',
  },
};

const which = process.argv[2] ?? 'liquid-unclosed';
const brk = BREAKS[which];
if (!brk) throw new Error(`unknown break: ${which}`);

async function latestBuild() {
  const b = await api('/pages/builds/latest');
  return { status: b.status, error: b.error, commit: b.commit, duration: b.duration };
}
async function deploymentPicture(sha: string) {
  const deps = await api(`/deployments?sha=${sha}&environment=github-pages`);
  if (!Array.isArray(deps) || deps.length === 0) return { deployment: null };
  const statuses = await api(`/deployments/${deps[0].id}/statuses`);
  return {
    deployment: { id: deps[0].id },
    statuses: (statuses as { state: string; description: string; environment_url?: string }[]).map(
      (s) => ({ state: s.state, description: s.description, environment_url: s.environment_url }),
    ),
  };
}

// Poll until the build for OUR commit reaches a genuinely terminal status.
// A failing legacy build sits in `building` far longer than the ~40s green
// path, so this waits up to ~15 min — and crucially never lets a later commit
// supersede the one we are watching (the bug in the first run).
async function pollBuildUntilTerminal(afterCommit: string) {
  const TERMINAL = new Set(['built', 'errored', 'error']);
  for (let i = 0; i < 90; i++) {
    const b = await latestBuild();
    process.stdout.write(
      `  [${i}] build.status=${b.status} commit=${b.commit?.slice(0, 8)} err=${JSON.stringify(b.error?.message)}\n`,
    );
    if (b.commit === afterCommit && TERMINAL.has(b.status)) return b;
    await sleep(10000);
  }
  return latestBuild();
}

const mode = process.argv[3] ?? 'break';

if (mode === 'break') {
  console.log(`\n### BREAK: ${which} — ${brk.why}\n`);
  const head = await gh.getHeadSha();
  const { sha } = await gh.commit({
    message: `PROTOTYPE #9 break: ${which}`,
    changes: [{ path: brk.file, content: brk.content }],
    expectedHeadSha: head,
  });
  console.log(`committed break ${sha}; polling pages/builds/latest to TERMINAL…`);
  const failed = await pollBuildUntilTerminal(sha);
  console.log(`\n--- pages/builds/latest ON FAILURE (full payload) ---`);
  console.log(JSON.stringify(await api('/pages/builds/latest'), null, 2));
  console.log(`\n--- Deployments API for the break sha ---`);
  console.log(JSON.stringify(await deploymentPicture(sha), null, 2));
  console.log(`\nterminal build.status = ${failed.status}`);
  console.log(`(leave it red; run with 'revert' to restore)`);
} else {
  console.log(`\n### REVERT — deleting ${brk.file}, waiting for green\n`);
  const head2 = await gh.getHeadSha();
  const { sha: fixSha } = await gh.commit({
    message: 'PROTOTYPE #9 revert break',
    deletions: [brk.file],
    expectedHeadSha: head2,
  });
  const green = await pollBuildUntilTerminal(fixSha);
  console.log(`\n${green.status === 'built' ? '✓ green restored' : '✗ still not green'}`);
}
