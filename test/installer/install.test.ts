import { describe, expect, it } from 'vitest';
import { renderIndexHtml, buildInstallCommit } from '../../src/installer/install.js';
import { readRepoConfig } from '../../src/app/config.js';

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <!-- installer writes: <meta name="dscms:repo" content="owner/name"> -->
    <title>DeadSimpleCMS</title>
  </head>
  <body><div id="app"></div><script src="./bundle.js"></script></body>
</html>`;

// Minimal querySelector over the rendered string, so we can prove the app's own
// readRepoConfig reads back exactly what the installer wrote.
function fakeDoc(html: string) {
  const m = html.match(/<meta name="dscms:repo" content="([^"]*)">/);
  return {
    querySelector: (sel: string) =>
      sel === 'meta[name="dscms:repo"]' && m ? { getAttribute: () => m[1] } : null,
  };
}

describe('renderIndexHtml', () => {
  it('replaces the placeholder with a meta the app reads back', () => {
    const out = renderIndexHtml(TEMPLATE, 'octocat/blog');
    expect(out).toContain('<meta name="dscms:repo" content="octocat/blog">');
    expect(out).not.toMatch(/installer writes:/);
    expect(readRepoConfig(fakeDoc(out))).toBe('octocat/blog');
  });

  it('falls back to <head> if the placeholder is gone', () => {
    const out = renderIndexHtml('<html><head><title>x</title></head></html>', 'a/b');
    expect(readRepoConfig(fakeDoc(out))).toBe('a/b');
  });
});

describe('buildInstallCommit', () => {
  const base = {
    adminPrefix: 'admin/',
    targetRepo: 'octocat/blog',
    indexTemplate: TEMPLATE,
    bundle: '/* app */',
  };

  it('writes exactly index.html and bundle.js, and deletes nothing', () => {
    const c = buildInstallCommit('main', { ...base, collisionKind: 'clean' });
    expect(c.changes.map((x) => x.path)).toEqual(['admin/index.html', 'admin/bundle.js']);
    expect(c).not.toHaveProperty('deletions');
    expect(c.branch).toBe('main');
  });

  it('honours a /docs source root', () => {
    const c = buildInstallCommit('gh-pages', {
      ...base,
      adminPrefix: 'docs/admin/',
      collisionKind: 'clean',
    });
    expect(c.changes.map((x) => x.path)).toEqual(['docs/admin/index.html', 'docs/admin/bundle.js']);
  });

  it('names the commit by what happened', () => {
    expect(buildInstallCommit('main', { ...base, collisionKind: 'ours' }).message).toMatch(/Repair/);
    expect(buildInstallCommit('main', { ...base, collisionKind: 'decap' }).message).toMatch(
      /replacing Decap/,
    );
    expect(buildInstallCommit('main', { ...base, collisionKind: 'clean' }).message).toBe(
      'Install DeadSimpleCMS',
    );
  });
});
