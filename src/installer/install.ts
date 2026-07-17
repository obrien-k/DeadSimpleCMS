// Building the install commit (#29, #3). The installer writes exactly two files
// in one Git Data commit — admin/index.html (the config anchor, #2) and
// admin/bundle.js (the vendored app). index.html is authored here with the
// target repo baked into its dscms:repo meta, so the anchor is correct by
// construction and the hand-typed-line failure class never happens.
import type { CollisionKind } from './collision.js';

// The comment contains ">" (its example meta tag), so match lazily across it.
const PLACEHOLDER = /<!--\s*installer writes:[\s\S]*?-->/;

/**
 * Insert the authoritative dscms:repo meta into the admin/index.html template.
 * The committed template carries a placeholder comment marking the spot; if it
 * is ever removed, fall back to just inside <head> so the anchor still lands.
 */
export function renderIndexHtml(template: string, repo: string): string {
  const meta = `<meta name="dscms:repo" content="${repo}">`;
  if (PLACEHOLDER.test(template)) return template.replace(PLACEHOLDER, meta);
  return template.replace(/<head>/i, `<head>\n    ${meta}`);
}

export interface InstallInputs {
  adminPrefix: string; // "admin/" or "docs/admin/" (#17)
  targetRepo: string;
  indexTemplate: string; // admin/index.html text
  bundle: string; // vendored bundle.js text
  collisionKind: CollisionKind;
}

export interface InstallCommit {
  message: string;
  branch: string;
  changes: { path: string; content: string }[];
}

/**
 * The two-file change set plus a commit message that reflects what happened —
 * repair vs first install vs a consented Decap replace. No file is ever
 * deleted; a Decap replace overwrites index.html (one commit, revertible) and
 * leaves config.yml and everything else in place.
 */
export function buildInstallCommit(branch: string, i: InstallInputs): InstallCommit {
  const message = commitMessage(i.collisionKind);
  return {
    message,
    branch,
    changes: [
      { path: `${i.adminPrefix}index.html`, content: renderIndexHtml(i.indexTemplate, i.targetRepo) },
      { path: `${i.adminPrefix}bundle.js`, content: i.bundle },
    ],
  };
}

function commitMessage(kind: CollisionKind): string {
  switch (kind) {
    case 'ours':
    case 'ours-moved':
      return 'Repair DeadSimpleCMS admin';
    case 'decap':
      return 'Install DeadSimpleCMS (replacing Decap admin/index.html)';
    default:
      return 'Install DeadSimpleCMS';
  }
}
