// New-key insertion (#6): form order, ranked by FILE position. Cases promoted
// from prototype/frontmatter-roundtrip/probe-insert.js.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { patch, split } from '../../src/frontmatter/index.js';

const fx = (n: string) =>
  readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

// Every byte outside the inserted lines must be identical — the same invariant
// the CST route protects for edits.
function collateral(before: string, after: string, insertedLines: string[]): string {
  const remaining = after.split('\n');
  for (const l of insertedLines) {
    const i = remaining.indexOf(l);
    if (i !== -1) remaining.splice(i, 1);
  }
  return remaining.join('\n');
}

describe('insert: form order ranked by file position', () => {
  it('description lands after date, ABOVE "# Taxonomy below"', () => {
    const raw = fx('01-comments-and-order.md');
    const out = patch(raw, { description: 'A new description' });
    const lines = out.split('\n');
    const desc = lines.findIndex((l) => l.startsWith('description:'));
    const date = lines.findIndex((l) => l.startsWith('date:'));
    const comment = lines.findIndex((l) => l.startsWith('# Taxonomy below'));
    expect(desc).toBeGreaterThan(date);
    expect(desc).toBeLessThan(comment);
    expect(
      collateral(split(raw)!.yaml, split(out)!.yaml, ['description: A new description']),
    ).toBe(split(raw)!.yaml);
  });

  it('ranks by file position when file order disagrees with form order', () => {
    // Fixture 01 orders categories BEFORE tags; the form is the reverse. The
    // last form-predecessor of image by FILE position is the tags block, so
    // image must land after tags (and before author).
    const raw = fx('01-comments-and-order.md');
    const out = patch(raw, { image: { path: '/assets/img/cover.png', alt: 'A cover' } });
    const lines = out.split('\n');
    const image = lines.findIndex((l) => l.startsWith('image:'));
    const beta = lines.findIndex((l) => l.trim() === '- beta');
    const author = lines.findIndex((l) => l.startsWith('author:'));
    expect(image).toBeGreaterThan(beta);
    expect(image).toBeLessThan(author);
    expect(lines[image + 1]).toMatch(/^ {2}path: /);
  });

  it('detects the file indent for nested blocks instead of assuming 2', () => {
    const four = '---\nlayout: post\ntitle: A post\nseo:\n    type: BlogPosting\n---\n\nBody.\n';
    const out = patch(four, { image: { path: '/a.png' } });
    expect(out).toContain('image:\n    path: /a.png');
  });

  it('falls back to before the first key when no form-predecessor is present', () => {
    const noTitle = '---\n# Header comment\ntags: [a]\n---\n\nBody.\n';
    const out = patch(noTitle, { title: 'Inserted' });
    const lines = split(out)!.yaml.split('\n');
    expect(lines.indexOf('title: Inserted')).toBeLessThan(
      lines.findIndex((l) => l.startsWith('tags:')),
    );
  });

  it('serializes values that would break a hand-built line', () => {
    const raw = fx('01-comments-and-order.md');
    for (const v of ['a title with: a colon', '#starts with a hash', 'yes', '']) {
      const out = patch(raw, { description: v });
      // Structure check only — typing is the Psych oracle's job.
      const descLine = out.split('\n').find((l) => l.startsWith('description:'))!;
      expect(descLine).not.toBe(`description: ${v}`); // must be escaped/quoted
    }
    const plain = patch(raw, { description: 'plain words' });
    expect(plain).toContain('description: plain words');
  });

  it('inserting a new key never re-renders existing lines (odd spacing survives)', () => {
    const raw = fx('03-odd-spacing-and-flow.md');
    const out = patch(raw, { description: 'added' });
    expect(out).toContain('title:    "Spacing is weird here"');
    expect(out).toContain('tags:     [ one,   two,   three ]');
    expect(out).toContain('unicode: "emoji 🎉 and café and 日本語"');
  });
});

describe('replace: editing a non-scalar value re-renders only that key', () => {
  it('replaces a block-sequence tags value in place', () => {
    const raw = fx('01-comments-and-order.md');
    const out = patch(raw, { tags: ['x', 'z'] });
    expect(out).toContain('tags:\n  - x\n  - z');
    expect(out).not.toContain('- alpha');
    // Everything around it is untouched.
    expect(out).toContain('categories: [jekyll, testing]');
    expect(out).toContain('author: kai');
    expect(out).toContain('# Taxonomy below');
  });
});
