import type { LeafKind } from '../frontmatter/index.js';

// What extra fields does this site's form show? (#13)
//
// No schema file, ever (docs/DESIGN.md "Jekyll-aware, zero config"). The form's
// extra fields are inferred from what the site's own recent posts carry.
//
// Two properties do the work, and both are choices worth stating:
//
// - The corpus is the RECENT window, not every post. Conventions drift: a blog
//   that started in 2015 with bare title/date and adopted `image.path` last year
//   has ~10% of its posts carrying it, so any all-posts threshold buries the very
//   field the design promises to surface. The window tracks what the author is
//   doing now, which is what their next post should look like.
//
// - The threshold is a strict majority OF that window — "more of your recent
//   posts have this than don't", which is a sentence the site's owner can check
//   by hand. It is self-dampening at small N because the form already unions in
//   the file's own keys: with two posts, a key in both is an own key on both, and
//   a key in one is 50% and not promoted. Inference starts mattering exactly when
//   there is enough corpus for "majority" to mean something.
//
// N has no evidence behind it — no measurement can tell us the right window, so
// it is one defensible number, stated, rather than a weighting curve nobody can
// inspect.
export const RECENT_WINDOW = 20;

/** What each post in the window carries: leaf path → the shape it holds there. */
export type KeyShapes = Record<string, LeafKind>;

export interface Inferred {
  path: string;
  /**
   * The shape to WRITE when the user fills this field in on a post that lacks
   * it. `list` wins any disagreement across the window: a one-item list reads
   * back the same as the scalar for Jekyll's `tags`-style keys, while a scalar
   * written where the site means a list silently degrades a taxonomy to one
   * string. The asymmetry is the whole tie-break.
   */
  kind: LeafKind;
}

/**
 * Leaf paths promoted to form fields, ordered by descending frequency then
 * alphabetically — the order the form places the ones a file lacks (#13).
 */
export function promote(window: readonly KeyShapes[]): Inferred[] {
  const counts = new Map<string, number>();
  const kinds = new Map<string, LeafKind>();
  for (const shapes of window) {
    for (const [path, kind] of Object.entries(shapes)) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
      if (kind === 'list' || !kinds.has(path)) kinds.set(path, kind);
    }
  }
  return [...counts]
    .filter(([, n]) => n * 2 > window.length)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path]) => ({ path, kind: kinds.get(path)! }));
}
