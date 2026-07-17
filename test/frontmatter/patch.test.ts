import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { patch } from '../../src/frontmatter/index.js';

const fx = (n: string) =>
  readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

const FIXTURES = [
  '01-comments-and-order.md',
  '02-nested-and-quoting.md',
  '03-odd-spacing-and-flow.md',
];

describe('patch: round-trip invariant', () => {
  it.each(FIXTURES)('%s survives a no-op patch byte-identical', (name) => {
    const raw = fx(name);
    expect(patch(raw, {})).toBe(raw);
  });

  it('editing one key changes exactly that line', () => {
    const raw = fx('01-comments-and-order.md');
    const out = patch(raw, { title: 'A New Title' });
    const before = raw.split('\n');
    const after = out.split('\n');
    expect(after.length).toBe(before.length);
    const changed = before.filter((l, i) => l !== after[i]);
    expect(changed).toEqual([
      'title: "The Old Title"   # trailing comment on the field we patch',
    ]);
    expect(out).toContain('A New Title');
    expect(out).toContain('# trailing comment on the field we patch');
  });

  it('rejects a file with no front matter', () => {
    expect(() => patch('Just a body.\n', { title: 'x' })).toThrow(/front matter/);
  });
});
