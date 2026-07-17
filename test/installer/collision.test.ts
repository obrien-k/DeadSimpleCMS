import { describe, expect, it } from 'vitest';
import { classifyCollision } from '../../src/installer/collision.js';

const REPO = 'octocat/blog';

describe('#8 collision classification', () => {
  it('empty admin/ is a clean install', () => {
    expect(
      classifyCollision({ adminEntries: [], indexRepoMeta: null, targetRepo: REPO }),
    ).toEqual({ kind: 'clean', blocks: false, destructive: false });
  });

  it('our install for this repo is a repair — never blocked', () => {
    const c = classifyCollision({
      adminEntries: ['admin/index.html', 'admin/bundle.js'],
      indexRepoMeta: REPO,
      targetRepo: REPO,
    });
    expect(c.kind).toBe('ours');
    expect(c.blocks).toBe(false);
    expect(c.destructive).toBe(false);
  });

  it('our install pointing at another repo repairs and repoints', () => {
    const c = classifyCollision({
      adminEntries: ['admin/index.html', 'admin/bundle.js'],
      indexRepoMeta: 'someone/else',
      targetRepo: REPO,
    });
    expect(c.kind).toBe('ours-moved');
    expect(c.blocks).toBe(false);
  });

  it('ours outranks a stray config.yml — repair is not blocked by Decap detection', () => {
    // The precedence guarantee from the resolution: a repo carrying both our
    // marker and a config.yml reads as ours.
    const c = classifyCollision({
      adminEntries: ['admin/index.html', 'admin/bundle.js', 'admin/config.yml'],
      indexRepoMeta: REPO,
      targetRepo: REPO,
    });
    expect(c.kind).toBe('ours');
  });

  it('a Decap install (config.yml, non-ours index) is a consented, destructive replace', () => {
    const c = classifyCollision({
      adminEntries: ['admin/index.html', 'admin/config.yml'],
      indexRepoMeta: null,
      targetRepo: REPO,
    });
    expect(c.kind).toBe('decap');
    expect(c.blocks).toBe(false); // proceeds — on explicit consent
    expect(c.destructive).toBe(true); // overwrites their index.html
  });

  it('config.yml with no index.html is still named as Decap', () => {
    const c = classifyCollision({
      adminEntries: ['admin/config.yml'],
      indexRepoMeta: null,
      targetRepo: REPO,
    });
    expect(c.kind).toBe('decap');
  });

  it('an unknown admin/index.html is refused — consent cannot be informed', () => {
    const c = classifyCollision({
      adminEntries: ['admin/index.html'],
      indexRepoMeta: null,
      targetRepo: REPO,
    });
    expect(c.kind).toBe('unknown-index');
    expect(c.blocks).toBe(true);
    expect(c.destructive).toBe(true);
  });

  it('admin/ with no overwritable file installs alongside', () => {
    const c = classifyCollision({
      adminEntries: ['admin/photos/cat.jpg', 'admin/notes.md'],
      indexRepoMeta: null,
      targetRepo: REPO,
    });
    expect(c.kind).toBe('unknown-safe');
    expect(c.blocks).toBe(false);
    expect(c.destructive).toBe(false);
  });

  it('our bundle.js without index.html is not treated as ours (no marker to trust)', () => {
    // Only index.html carries the marker; a lone bundle.js proves nothing.
    const c = classifyCollision({
      adminEntries: ['admin/bundle.js'],
      indexRepoMeta: null,
      targetRepo: REPO,
    });
    expect(c.kind).toBe('unknown-safe');
  });
});
