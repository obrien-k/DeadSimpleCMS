import { describe, expect, it } from 'vitest';
import { IMAGE_DIR_DEFAULT, imageDir, imageFilename, insertionMarkdown } from '../../src/image/index.js';

const files = (...paths: string[]) => paths.map((path) => ({ path }));

// #14. Where an uploaded image lands is inferred from what the site already
// does — the same posture as #13's field inference and #17's root resolution:
// read the site, and when it says nothing, fall back to ONE stated default.
describe('imageDir: where uploads go', () => {
  it('reuses the directory the site already puts images in', () => {
    expect(imageDir(files('assets/img/a.jpg', 'assets/img/b.png', 'assets/css/main.css'))).toEqual({
      dir: 'assets/img',
      inferred: true,
    });
  });

  it('honours a site that uses a different convention', () => {
    expect(imageDir(files('images/cat.jpg', 'images/dog.jpg', 'about.md'))).toEqual({
      dir: 'images',
      inferred: true,
    });
  });

  // N=0: a fresh `jekyll new` site has no images at all, so there is nothing to
  // read and a default is unavoidable. It must be stated, not a config prompt.
  it('falls back to the default when the site has no images (N=0)', () => {
    expect(imageDir(files('_posts/2026-01-01-hi.md', '_config.yml', 'index.md'))).toEqual({
      dir: IMAGE_DIR_DEFAULT,
      inferred: false,
    });
    expect(imageDir([])).toEqual({ dir: IMAGE_DIR_DEFAULT, inferred: false });
  });

  it('most-used dir wins; ties break toward the shallower path', () => {
    expect(
      imageDir(files('img/a.jpg', 'assets/pics/b.jpg', 'assets/pics/c.jpg')).dir,
    ).toBe('assets/pics');
    expect(imageDir(files('deep/nested/a.jpg', 'img/b.jpg')).dir).toBe('img');
  });

  // A root favicon or an svg the site keeps at top level is not "the images
  // folder" — only directoried images vote.
  it('ignores images sitting at the repo root', () => {
    expect(imageDir(files('favicon.png', 'logo.svg', 'assets/img/post.jpg'))).toEqual({
      dir: 'assets/img',
      inferred: true,
    });
  });
});

// #14 / #4. The markdown stored in the body must be site-root-relative and must
// NOT bake in `{{ site.baseurl }}` — that is Liquid in body text (#12 says the
// preview misrenders it) and it is the sitemap bug #4 caught, moved into posts.
describe('insertionMarkdown: what lands in the body', () => {
  it('is root-relative with a leading slash, no baseurl Liquid', () => {
    expect(insertionMarkdown('assets/img', 'ugly.jpg')).toBe('![](/assets/img/ugly.jpg)');
  });

  // Empty alt is an accessibility failure and invented alt is a lie: the owner
  // writes the words, so the default is honestly blank.
  it('leaves alt empty by default and carries owner-supplied alt through', () => {
    expect(insertionMarkdown('images', 'sunset.jpg', 'Sunset over the bay')).toBe(
      '![Sunset over the bay](/images/sunset.jpg)',
    );
  });

  it('never doubles a slash if the dir carries a trailing one', () => {
    expect(insertionMarkdown('assets/img/', 'x.jpg')).toBe('![](/assets/img/x.jpg)');
  });
});

// The upload is always re-encoded to JPEG, so the stored name is always .jpg
// regardless of what the phone called it (IMG_1234.HEIC → .jpg). A unique
// suffix keeps a second "sunset" upload from silently overwriting the first —
// a real data-loss bug for a git-averse owner who cannot see the tree.
describe('imageFilename: a safe, non-colliding name', () => {
  it('slugifies the original basename and forces .jpg', () => {
    expect(imageFilename('My Vacation Photo.HEIC', 'k3f9')).toBe('my-vacation-photo-k3f9.jpg');
  });

  it('drops the original extension, whatever it was', () => {
    expect(imageFilename('IMG_1234.png', 'ab12')).toBe('img-1234-ab12.jpg');
  });

  it('falls back to a stable stem when the name is unusable', () => {
    expect(imageFilename('', 'ab12')).toBe('image-ab12.jpg');
    expect(imageFilename('.…', 'ab12')).toBe('image-ab12.jpg');
  });
});
