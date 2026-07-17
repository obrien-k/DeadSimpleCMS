import { describe, expect, it } from 'vitest';
import { promote, type KeyShapes } from '../../src/infer/index.js';

const post = (...paths: string[]): KeyShapes =>
  Object.fromEntries(paths.map((p) => [p, 'scalar' as const]));

const paths = (window: KeyShapes[]) => promote(window).map((i) => i.path);

// #13. The threshold is a strict majority of the recent window: "more of your
// recent posts have this than don't" — a sentence the site's owner can check by
// hand against their last twenty posts.
describe('promote: which keys earn a form field', () => {
  it('a key most recent posts carry is promoted', () => {
    expect(paths([post('title', 'image.path'), post('title', 'image.path'), post('title')])).toEqual(
      ['title', 'image.path'],
    );
  });

  it('exactly half is NOT a majority', () => {
    expect(paths([post('title', 'image.path'), post('title')])).toEqual(['title']);
  });

  it('a one-off never becomes a permanent field on every post', () => {
    const window = [post('title', 'mathjax'), post('title'), post('title'), post('title')];
    expect(paths(window)).toEqual(['title']);
  });

  it('orders by descending frequency, then alphabetically — the order the form uses', () => {
    const window = [
      post('title', 'author', 'permalink'),
      post('title', 'author', 'permalink'),
      post('title', 'author'),
    ];
    // title 3, author 3, permalink 2 — title/author tie breaks alphabetically.
    expect(paths(window)).toEqual(['author', 'title', 'permalink']);
  });

  it('counts posts, not occurrences: a path cannot vote twice', () => {
    expect(paths([post('title'), post('title'), {}, {}, {}])).toEqual([]);
  });

  it('an empty window promotes nothing rather than dividing by zero', () => {
    expect(promote([])).toEqual([]);
  });

  // The property that makes the threshold safe on a young blog: the form
  // already unions in the file's own keys, so at N=1 inference tells it nothing
  // it did not have, and at N=2 a key in one post is 50% and not promoted.
  it('is inert at N=1 — every promoted key is already the post own key', () => {
    expect(paths([post('title', 'weird')])).toEqual(['title', 'weird']);
  });

  describe('the shape to write when a post lacks the key', () => {
    it('carries the corpus shape, so a list stays a list', () => {
      const window = [{ tags: 'list' as const }, { tags: 'list' as const }];
      expect(promote(window)).toEqual([{ path: 'tags', kind: 'list' }]);
    });

    // A scalar written where the site means a list silently degrades a taxonomy
    // to one string; a one-item list reads back the same as the scalar.
    it('list wins a disagreement, whichever order the window is in', () => {
      const mixed = [{ tags: 'scalar' as const }, { tags: 'list' as const }, { tags: 'scalar' as const }];
      expect(promote(mixed)).toEqual([{ path: 'tags', kind: 'list' }]);
      expect(promote([...mixed].reverse())).toEqual([{ path: 'tags', kind: 'list' }]);
    });
  });
});
