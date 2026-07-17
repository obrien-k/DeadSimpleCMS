import { describe, expect, it } from 'vitest';
import { buildFields } from '../../src/app/views/Editor.js';
import { read } from '../../src/frontmatter/index.js';
import type { Inferred } from '../../src/infer/index.js';

const dataOf = (yaml: string) => read(`---\n${yaml}\n---\nbody\n`)!.data;
const scalar = (...paths: string[]): Inferred[] => paths.map((path) => ({ path, kind: 'scalar' }));
const post = (yaml: string, inferred: Inferred[] = []) =>
  buildFields(dataOf(yaml), inferred, true).map((f) => f.path);
const page = (yaml: string, inferred: Inferred[] = []) =>
  buildFields(dataOf(yaml), inferred, false).map((f) => f.path);

const SIX = ['title', 'date', 'description', 'tags', 'categories', 'image.path'];

// #13. The form is the six (posts only) ∪ the file's own keys ∪ the inferred
// keys — a pure function of the file plus the corpus, with no dependence on how
// the user arrived at the file.
describe('buildFields: what the form shows', () => {
  it('a post with nothing gets the fixed six, in form order', () => {
    expect(post('layout: post')).toEqual([...SIX, 'layout']);
  });

  it('a brand-new post and an existing empty one get the same form', () => {
    expect(buildFields({}, [], true).map((f) => f.path)).toEqual(SIX);
  });

  describe('pages get their own keys reflected back, and nothing else (#12)', () => {
    // about.md has no use for a Date or a Categories field, and offering one
    // only invites a writer to put a post key into a page.
    it('no six, no date, no categories', () => {
      expect(page('title: About\npermalink: /about/')).toEqual(['title', 'permalink']);
    });

    it('inference never reaches a page — pages are not a corpus', () => {
      expect(page('title: About', scalar('image.path', 'tags'))).toEqual(['title']);
    });

    it('own keys in file order: the form mirrors the file', () => {
      expect(page('permalink: /x/\ntitle: X\nlayout: home')).toEqual([
        'permalink',
        'title',
        'layout',
      ]);
    });
  });

  describe('an inferred key the file lacks', () => {
    it('is shown, empty — the honest reading of "this site does, this post does not"', () => {
      const fields = buildFields(dataOf('title: T'), scalar('author'), true);
      expect(fields.map((f) => f.path)).toEqual([...SIX, 'author']);
    });

    it('is not duplicated when the file already has it', () => {
      expect(post('title: T\nauthor: Kay', scalar('author'))).toEqual([...SIX, 'author']);
    });
  });

  describe('the six yield to whatever the file or the corpus actually says', () => {
    it('a scalar `image:` in the file wins over the `image.path` default', () => {
      expect(post('image: /a.png')).toEqual([
        'title',
        'date',
        'description',
        'tags',
        'categories',
        'image',
      ]);
    });

    it('a corpus of scalar `image:` wins over the `image.path` default', () => {
      const fields = buildFields({}, [{ path: 'image', kind: 'scalar' }], true);
      expect(fields.map((f) => f.path)).toEqual([...SIX.slice(0, 5), 'image']);
    });

    // The bug this rule exists to prevent: two cover-image fields, one of which
    // silently writes a different shape than the other.
    it('never renders both `image` and `image.path`', () => {
      const fields = buildFields(dataOf('image: /a.png'), scalar('image.path'), true);
      expect(fields.filter((f) => f.path.startsWith('image'))).toHaveLength(1);
    });

    it('keeps every leaf under a six key, in the six slot', () => {
      expect(post('image:\n  path: /a.png\n  alt: A cat')).toEqual([
        'title',
        'date',
        'description',
        'tags',
        'categories',
        'image.path',
        'image.alt',
      ]);
    });
  });

  describe('order (#7): six, then own keys in file order, then inferred by frequency', () => {
    it('extras follow the six', () => {
      const fields = post('permalink: /x/\nauthor: Kay');
      expect(fields).toEqual([...SIX, 'permalink', 'author']);
    });

    it('inferred-but-absent keys come after the file own extras', () => {
      // `promote` already ordered these by descending frequency.
      const fields = post('permalink: /x/', scalar('author', 'redirect_from'));
      expect(fields).toEqual([...SIX, 'permalink', 'author', 'redirect_from']);
    });
  });

  describe('labels (#8)', () => {
    const label = (yaml: string, path: string) =>
      buildFields(dataOf(yaml), [], true).find((f) => f.path === path)!.label;

    it('the six keep their hand-written labels', () => {
      expect(label('title: T', 'title')).toBe('Title');
      expect(label('title: T', 'tags')).toBe('Tags (comma-separated)');
    });

    it('a cover image is labelled the same whichever shape the file uses', () => {
      expect(label('image: /a.png', 'image')).toBe('Cover image path');
      expect(label('image:\n  path: /a.png', 'image.path')).toBe('Cover image path');
    });

    // "Redirect From" is a name that exists nowhere and cannot be searched for;
    // `redirect_from` is the exact string the plugin's README uses.
    it('an extra is labelled with its raw key path, verbatim', () => {
      expect(label('redirect_from:\n  - /old/', 'redirect_from')).toBe(
        'redirect_from (comma-separated)',
      );
      expect(label('header:\n  teaser: /t.png', 'header.teaser')).toBe('header.teaser');
    });

    it('image.alt does not inherit the cover image label', () => {
      expect(label('image:\n  path: /a.png\n  alt: A cat', 'image.alt')).toBe('image.alt');
    });
  });

  // The stated blind spot: no text widget round-trips a list of maps, so the
  // form cannot show it. `patch` never names the key, so it survives untouched.
  it('a key whose shape gets no field is absent from the form', () => {
    expect(page('title: T\ngallery:\n  - url: /1.png')).toEqual(['title']);
  });
});
