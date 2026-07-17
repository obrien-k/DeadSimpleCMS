// The YAML typing rule (DESIGN.md "YAML typing" decision): Jekyll parses with
// Psych at YAML 1.1, and the CST edit path quotes only for structural breakage,
// so unsafe values must be forced into quotes. Expected outcomes come from the
// prototype's Psych-verified table (0 wrong of 14 with the rule applied); the
// real oracle is test/frontmatter/psych.test.ts, which asks Psych itself.
import { describe, expect, it } from 'vitest';
import { patch } from '../../src/frontmatter/index.js';

// The common case: the owner's original value is unquoted.
const UNQUOTED = '---\ntitle: The Old Title\ndate: 2024-03-01 10:00:00 +0000\n---\n\nBody.\n';

const line = (out: string) => out.split('\n').find((l) => l.startsWith('title:'))!;

describe('typing: CST edits force quotes exactly when 1.1 would re-type', () => {
  it.each([
    ['yes', 'boolean in 1.1'],
    ['NO', 'boolean in 1.1'],
    ['12:30', 'sexagesimal → 45000'],
    ['1_000', 'underscored int → 1000'],
    ['0777', 'octal → 511'],
    ['2024-03-01', 'date'],
  ])('"%s" gets double-quoted (%s)', (value) => {
    expect(line(patch(UNQUOTED, { title: value }))).toBe(`title: "${value}"`);
  });

  it('a value the 1.1 serializer leaves plain keeps the owner formatting', () => {
    expect(line(patch(UNQUOTED, { title: 'An Ordinary Title' }))).toBe(
      'title: An Ordinary Title',
    );
  });

  it('non-string scalars stay plain', () => {
    const raw = '---\ntitle: T\nweight: 3\n---\n\nB.\n';
    const out = patch(raw, { weight: 42 });
    expect(out).toContain('weight: 42');
  });
});
