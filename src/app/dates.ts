// Date handling for posts. toISOString() is UTC and future-dates posts
// written in the evening of a UTC+ zone — Jekyll then silently drops them
// (future: false). Dates are always built from local time with an explicit
// offset; the prototype written to test that trap fell into it.
export function jekyllDate(now: Date, offsetMinutes: number = now.getTimezoneOffset()): string {
  const local = new Date(now.getTime() - offsetMinutes * 60_000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const sign = offsetMinutes <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} ` +
    `${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())} ` +
    `${sign}${p(Math.floor(abs / 60))}${p(abs % 60)}`
  );
}

// `postsDir` is passed, never assumed: a /docs-served or collections_dir site
// reads posts from somewhere else entirely, and a publish written to the wrong
// place never goes live (#17). Jekyll's date-prefixed filename convention is
// still ours to own — only the directory moves.
export function publishPath(slug: string, frontMatterDate: string, postsDir: string): string {
  return `${postsDir}/${frontMatterDate.slice(0, 10)}-${slug}.md`;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
