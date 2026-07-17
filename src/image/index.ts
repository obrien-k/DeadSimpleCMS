// Image upload (#14). The plumbing — image + post in one commit — was proved by
// prototype/git-data-move; everything here is the decisions above it, measured
// in prototype/image-pipeline against a real 4000×3000, 5.92 MB, EXIF-rotated,
// GPS-tagged phone photo.
//
// Three of the four exports are pure and tested. `downscale` is browser-only
// glue (createImageBitmap/OffscreenCanvas exist in no test runner here); its
// behaviour — 24× shrink, orientation baked in, all EXIF/GPS stripped — is
// what the prototype verified, so it stays deliberately thin.
import { slugify } from '../app/dates.js';

/**
 * The default when the site has no images to learn from. `assets/img` is the
 * most common theme convention and, unlike bare `assets/`, keeps uploads clear
 * of a theme's CSS/JS. Stated, not configurable (DESIGN.md "zero config").
 */
export const IMAGE_DIR_DEFAULT = 'assets/img';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/**
 * Where an uploaded image lands. Reuse the directory the site already puts
 * images in — read from the source files the layout resolve already fetched
 * (#17's tree walk, fence-filtered), so no extra request. Most-used dir wins;
 * ties break toward the shallower path, the one a human calls "the images
 * folder". At N=0 there is nothing to read, so the stated default stands.
 *
 * `inferred` is false only for the default, so a caller can tell the owner
 * "put in assets/img" when the app is guessing rather than following the site.
 */
export function imageDir(
  sourceFiles: readonly { path: string }[],
): { dir: string; inferred: boolean } {
  const counts = new Map<string, number>();
  for (const { path } of sourceFiles) {
    if (!IMAGE_EXT.test(path) || !path.includes('/')) continue;
    const dir = path.slice(0, path.lastIndexOf('/'));
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  if (counts.size === 0) return { dir: IMAGE_DIR_DEFAULT, inferred: false };
  const [dir] = [...counts].sort(
    (a, b) => b[1] - a[1] || a[0].split('/').length - b[0].split('/').length || a[0].localeCompare(b[0]),
  )[0]!;
  return { dir, inferred: true };
}

/**
 * The markdown inserted into the post body. Site-root-relative with a leading
 * slash — the form Jekyll's own `{% link %}` resolves against and applies
 * `baseurl` to at SERVE time. Never bake `{{ site.baseurl }}` into stored
 * markdown: it is Liquid in body text (#12's preview misrenders it) and it is
 * the #4 sitemap bug transplanted into posts.
 *
 * Alt defaults to empty because empty alt is an accessibility failure the owner
 * can fix, while invented alt text is a confident lie they cannot see (#14).
 */
export function insertionMarkdown(dir: string, filename: string, alt = ''): string {
  const path = ('/' + dir + '/' + filename).replace(/\/+/g, '/');
  return `![${alt}](${path})`;
}

/**
 * A safe stored name for the re-encoded upload. Always `.jpg` — the pixels are
 * re-encoded to JPEG regardless of what the phone called them (HEIC, PNG). The
 * `uniq` suffix keeps a second "sunset" upload from silently overwriting the
 * first in the tree, which a git-averse owner could never detect.
 */
export function imageFilename(originalName: string, uniq: string): string {
  const stem = slugify(originalName.replace(/\.[^.]+$/, '')) || 'image';
  return `${stem}-${uniq}.jpg`;
}

/** Long-edge cap: a blog column is ~700 CSS px; 1600 is 2× retina with room. */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

/**
 * Downscale a dropped photo and, as an unavoidable side effect of re-encoding,
 * strip all EXIF including GPS. Browser-only: no test runner here has canvas,
 * so the behaviour lives in prototype/image-pipeline (5.92 MB → ~240 kB, a 24×
 * shrink; orientation baked into the pixels; GPS gone).
 *
 * `imageOrientation: 'from-image'` is explicit even though Chromium already
 * auto-orients — the guarantee is not universal across browsers, and a dropped
 * rotation flag renders the photo sideways.
 *
 * A PNG with transparency flattens onto black here; the target is phone photos,
 * not logos, and JPEG has no alpha. Worth knowing before this grows a PNG path.
 */
export async function downscale(
  file: Blob,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
  return { blob, width, height };
}
