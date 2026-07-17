import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { read } from '../../src/frontmatter/index.js';

const fx = (n: string) =>
  readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

describe('read: parses front matter the way the app must (1.1)', () => {
  it('returns data and untouched body', () => {
    const { data, body } = read(fx('01-comments-and-order.md'))!;
    expect(data.title).toBe('The Old Title');
    expect(data.author).toBe('kai');
    expect(data.tags).toEqual(['alpha', 'beta']);
    expect(body).toBe('\nBody text stays untouched.\n');
  });

  it('reads 1.1 booleans as Jekyll does', () => {
    // `yes` is boolean true to Psych; the app must agree with the site.
    const { data } = read('---\nbool_yes: yes\n---\n\nB.\n')!;
    expect(data.bool_yes).toBe(true);
  });

  it('returns null for a file with no front matter', () => {
    expect(read('No front matter here.\n')).toBeNull();
  });
});
