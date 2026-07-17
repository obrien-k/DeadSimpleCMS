import { describe, expect, it } from 'vitest';
import { leaves, read } from '../../src/frontmatter/index.js';

const dataOf = (yaml: string) => read(`---\n${yaml}\n---\nbody\n`)!.data;

// #13. `leaves` is the whole of "which key shapes get a form field", and it is
// also what inference counts — so every rule here shows up twice downstream.
describe('leaves: the editable shape of front matter', () => {
  it('a scalar is its own leaf, addressed by its bare key', () => {
    expect(leaves(dataOf('title: Hello'))).toEqual([
      { path: 'title', value: 'Hello', kind: 'scalar' },
    ]);
  });

  it('a map recurses to leaf paths — this is why the form needs no image special case', () => {
    expect(leaves(dataOf('image:\n  path: /a.png\n  alt: A cat'))).toEqual([
      { path: 'image.path', value: '/a.png', kind: 'scalar' },
      { path: 'image.alt', value: 'A cat', kind: 'scalar' },
    ]);
  });

  it('a scalar `image:` yields `image` — the file names its own shape', () => {
    expect(leaves(dataOf('image: /a.png')).map((l) => l.path)).toEqual(['image']);
  });

  it('a sequence of scalars is ONE leaf, not one per item', () => {
    expect(leaves(dataOf('tags:\n  - a\n  - b'))).toEqual([
      { path: 'tags', value: ['a', 'b'], kind: 'list' },
    ]);
  });

  // The stated blind spot: no text widget round-trips it, so the form cannot
  // show it and `patch` never names it — the key survives untouched in the file.
  it('a sequence holding maps yields NO leaf', () => {
    const data = dataOf('title: T\ngallery:\n  - url: /1.png\n    alt: One');
    expect(leaves(data).map((l) => l.path)).toEqual(['title']);
  });

  it('nests arbitrarily deep — no invented depth cap', () => {
    expect(leaves(dataOf('a:\n  b:\n    c:\n      d: deep')).map((l) => l.path)).toEqual(['a.b.c.d']);
  });

  it('keeps file order, which is the order the form shows extras in', () => {
    expect(leaves(dataOf('zebra: 1\napple: 2\nmango: 3')).map((l) => l.path)).toEqual([
      'zebra',
      'apple',
      'mango',
    ]);
  });

  it('an empty list is still an editable leaf; an empty map contributes nothing', () => {
    expect(leaves(dataOf('tags: []\nimage: {}'))).toEqual([
      { path: 'tags', value: [], kind: 'list' },
    ]);
  });

  it('a valueless key is a null scalar, not an absent one', () => {
    expect(leaves(dataOf('description:'))).toEqual([
      { path: 'description', value: null, kind: 'scalar' },
    ]);
  });
});
