import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/app/diff.js';

// The line highlight behind Variant B's side-by-side conflict compare (#15):
// given my text and theirs, mark which lines differ so each column can shade
// them. LCS-based, so a line that merely moved or repeats is not mis-flagged.
describe('diffLines: which lines to highlight in the compare', () => {
  it('identical text highlights nothing on either side', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc');
    expect(d.mine.every((l) => !l.changed)).toBe(true);
    expect(d.theirs.every((l) => !l.changed)).toBe(true);
  });

  it('a line changed on both sides is highlighted on both; shared lines are not', () => {
    const d = diffLines('a\nB\nc', 'a\nb\nc');
    expect(d.mine.map((l) => l.changed)).toEqual([false, true, false]);
    expect(d.theirs.map((l) => l.changed)).toEqual([false, true, false]);
  });

  it('a line only I added is highlighted on my side only', () => {
    const d = diffLines('a\nb\nc\nd', 'a\nb\nc');
    expect(d.mine.map((l) => l.changed)).toEqual([false, false, false, true]);
    expect(d.theirs.map((l) => l.changed)).toEqual([false, false, false]);
  });

  it('a line only they added is highlighted on their side only', () => {
    const d = diffLines('a\nb', 'a\nx\nb');
    expect(d.mine.map((l) => l.changed)).toEqual([false, false]);
    expect(d.theirs.map((l) => l.changed)).toEqual([false, true, false]);
  });

  it('carries each line’s text through for rendering', () => {
    const d = diffLines('title: Mine', 'title: Theirs');
    expect(d.mine[0]).toEqual({ text: 'title: Mine', changed: true });
    expect(d.theirs[0]).toEqual({ text: 'title: Theirs', changed: true });
  });
});
