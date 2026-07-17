// PROTOTYPE — throwaway. `TOKEN_FILE=… REPO=owner/name node setup.js`
//
// Brings the scratch repo up to a *correct* Jekyll project site so run.js
// measures the happy path rather than a misconfiguration. Idempotent: commits
// only when content actually differs.
//
// Why this is needed: the scratch repo was a bare fixture (no index.md, no
// sitemap plugin, and `baseurl: ""` while being served under /<repo>/). That
// last one matters — see NOTES.md, it silently poisons every sitemap URL.

import { readFileSync } from 'node:fs';
import { Api } from '../git-data-move/api.js';

const TOKEN = readFileSync(process.env.TOKEN_FILE, 'utf8').trim();
const REPO = process.env.REPO;
const BRANCH = 'main';
const api = new Api(TOKEN, REPO);

const D = '\x1b[2m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';

// Ask GitHub where the site actually lives rather than deriving it. The repo
// has no CNAME file — the custom domain is inherited from the user's Pages
// site — so this endpoint is the only honest source.
const pages = await api.req('GET', `/repos/${REPO}/pages`);
const siteUrl = pages.html_url.replace(/\/$/, '');
const baseurl = new URL(siteUrl).pathname.replace(/\/$/, '');
const origin = new URL(siteUrl).origin;

console.log(`\n${'='.repeat(66)}\nFinish-line setup — ${REPO}\n${'='.repeat(66)}`);
console.log(`  site:    ${siteUrl}`);
console.log(`  origin:  ${origin}`);
console.log(`  baseurl: "${baseurl}"   ${D}(derived from the Pages URL, not guessed)${X}`);
console.log(`  build:   ${pages.build_type}`);

const config = `title: Scratch Site
description: Throwaway target for DeadSimpleCMS prototypes.
url: "${origin}"
baseurl: "${baseurl}"
plugins:
  - jekyll-sitemap
`;

const index = `---
title: Scratch Site
---

# Scratch Site

{% for post in site.posts %}
- [{{ post.title }}]({{ post.url | relative_url }}) — {{ post.date | date: "%Y-%m-%d" }}
{% endfor %}
`;

const want = [
  { path: '_config.yml', content: config },
  { path: 'index.md', content: index },
];

// Compare against what is live before writing, so re-runs are free.
const ref = await api.getRef(BRANCH);
const tree = await api.getTree(ref.object.sha);
const changed = [];
for (const w of want) {
  const entry = tree.tree.find((e) => e.path === w.path);
  const current = entry ? await api.getBlobText(entry.sha) : null;
  if (current !== w.content) changed.push(w);
  else console.log(`  ${D}unchanged: ${w.path}${X}`);
}

if (changed.length === 0) {
  console.log(`\n${G}already configured — nothing to commit${X}\n`);
  process.exit(0);
}

const headCommit = await api.getCommit(ref.object.sha);
const blobs = await Promise.all(changed.map((c) => api.createBlob(c.content)));
const newTree = await api.createTree(
  headCommit.tree.sha,
  changed.map((c, i) => ({ path: c.path, mode: '100644', type: 'blob', sha: blobs[i].sha })),
);
const commit = await api.createCommit('Configure scratch site for finish-line prototype', newTree.sha, [ref.object.sha]);
await api.updateRef(BRANCH, commit.sha);

console.log(`\n${Y}committed ${commit.sha.slice(0, 7)}${X} — ${changed.map((c) => c.path).join(', ')}`);
console.log(`${D}Pages will rebuild; run.js waits for its own commit's build anyway.${X}\n`);
