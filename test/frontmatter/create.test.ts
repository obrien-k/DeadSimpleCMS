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
