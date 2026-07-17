import { describe, expect, it } from 'vitest';
import { create, read } from '../../src/frontmatter/index.js';

describe('create: a fresh draft file', () => {
  it('renders fields in form order with the body attached', () => {
    const raw = create(
      { title: 'Hello', date: '2026-07-16 10:00:00 +0200', tags: ['a'] },
      'The body.\n',
    );
    expect(raw).toBe(
      '---\ntitle: Hello\ndate: 2026-07-16 10:00:00 +0200\ntags:\n  - a\n---\n\nThe body.\n',
    );
  });

  it('applies the 1.1 typing rule to new files too', () => {
    const raw = create({ title: 'yes' }, '');
    expect(raw).toContain('title: "yes"');
    // And the app reads back what Jekyll will read.
    expect(read(raw)!.data.title).toBe('yes');
  });

  it('skips empty fields', () => {
    const raw = create({ title: 'T', description: '', tags: [] }, 'B');
    expect(raw).not.toContain('description');
    expect(raw).not.toContain('tags');
  });
});

// #13. The form addresses front matter by dotted leaf path, so `create` takes
// the same address space `patch` does — otherwise a new draft would grow a key
// literally named "image.path".
describe('create: dotted leaf paths build nested front matter', () => {
  it('expands image.path into a nested map', () => {
    expect(create({ title: 'T', 'image.path': '/a.png' }, 'Body.\n')).toBe(
      '---\ntitle: T\nimage:\n  path: /a.png\n---\n\nBody.\n',
    );
  });

  it('merges sibling leaves under one key', () => {
    expect(create({ 'image.path': '/a.png', 'image.alt': 'A cat' }, 'B\n')).toBe(
      '---\nimage:\n  path: /a.png\n  alt: A cat\n---\n\nB\n',
    );
  });

  it('a plain key has no dots and expands to itself', () => {
    expect(create({ title: 'T' }, 'B\n')).toBe('---\ntitle: T\n---\n\nB\n');
  });

  it('still omits empties rather than writing an empty nest', () => {
    expect(create({ title: 'T', 'image.path': '' }, 'B\n')).toBe('---\ntitle: T\n---\n\nB\n');
  });
});
