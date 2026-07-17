// Hash routing: a static page has no server to rewrite URLs, so the view
// lives after "#/". Three views is the whole app.
export type Route = { view: 'list' } | { view: 'new' } | { view: 'edit'; path: string };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'new') return { view: 'new' };
  if (h.startsWith('edit/')) return { view: 'edit', path: decodeURIComponent(h.slice(5)) };
  return { view: 'list' };
}

export function editRoute(path: string): string {
  return `#/edit/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
}
