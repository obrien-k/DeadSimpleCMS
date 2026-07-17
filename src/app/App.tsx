import { useEffect, useMemo, useState } from 'preact/hooks';
import { createClient, type GhClient } from '../gh/index.js';
import { LayoutError, resolveLayout, type Resolved } from '../layout/index.js';
import { parseRoute, type Route } from './router.js';
import { checkTokenFormat, repoStore, tokenStore } from './token.js';
import { describeAssumedRoot, MSG } from './messages.js';
import { Setup } from './views/Setup.js';
import { ListView } from './views/List.js';
import { EditorView } from './views/Editor.js';
import { PublishView, type PublishTarget } from './views/Publish.js';

export interface AppProps {
  /** From the installer-written config anchor; null = first-run prompt. */
  configuredRepo: string | null;
  storage: Storage;
}

export function App({ configuredRepo, storage }: AppProps) {
  const [route, setRoute] = useState<Route>(parseRoute(location.hash));
  const [token, setToken] = useState<string | null>(tokenStore.get(storage));
  const [promptedRepo, setPromptedRepo] = useState<string | null>(repoStore.get(storage));
  const [publishing, setPublishing] = useState<PublishTarget | null>(null);
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const repo = configuredRepo ?? promptedRepo;

  useEffect(() => {
    const onHash = () => {
      setPublishing(null);
      const next = parseRoute(location.hash);
      // Landing on the list re-resolves rather than reusing what is held:
      // the resolution carries the listing with it (one query answers both),
      // and a list that survives a save is a list that lies.
      if (next.view === 'list') setReloads((n) => n + 1);
      setRoute(next);
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const gh: GhClient | null = useMemo(
    () => (token && repo ? createClient({ token, repo }) : null),
    [token, repo],
  );

  // The token reports its own expiry on every response — warn before the 401.
  const refreshExpiry = () => {
    const exp = gh?.tokenExpiry();
    if (exp) setExpiryDays(Math.floor((exp.getTime() - Date.now()) / 86_400_000));
  };

  // Where Jekyll reads from is resolved once per load, before any view runs:
  // every path the app touches hangs off it, and #17 exists because phase 1
  // assumed the answer instead. Deliberately not cached across loads — a stale
  // root is exactly the silent wrongness this resolves, and it is the one
  // value whose staleness has no content hash to catch it.
  useEffect(() => {
    if (!gh) return;
    let cancelled = false;
    setResolved(null);
    setLayoutError(null);
    resolveLayout(gh)
      .then((r) => {
        if (cancelled) return;
        setResolved(r);
        refreshExpiry();
      })
      .catch((e) => {
        if (cancelled) return;
        setLayoutError(
          e instanceof LayoutError ? MSG.noJekyllSite(e.root) : String(e instanceof Error ? e.message : e),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [gh, reloads]);

  if (!gh || !repo) {
    return (
      <Setup
        configuredRepo={configuredRepo}
        onSubmit={async (tok, rep) => {
          const check = checkTokenFormat(tok);
          if (!check.ok) return check.reason === 'classic' ? MSG.classicToken : MSG.emptyToken;
          const probe = createClient({ token: tok.trim(), repo: rep });
          if (!(await probe.probeWrite())) return MSG.probeFailed;
          tokenStore.set(storage, tok);
          if (!configuredRepo) {
            repoStore.set(storage, rep);
            setPromptedRepo(rep);
          }
          setToken(tok.trim());
          return null;
        }}
      />
    );
  }

  const banner =
    expiryDays !== null && expiryDays <= 30 ? (
      <p class="banner warn">{MSG.expiryWarning(Math.max(expiryDays, 0))}</p>
    ) : null;

  if (publishing) {
    return (
      <main>
        {banner}
        <PublishView gh={gh} target={publishing} onDone={() => (location.hash = '#/')} />
      </main>
    );
  }

  if (layoutError) {
    return (
      <main>
        {banner}
        <p class="banner error">{layoutError}</p>
      </main>
    );
  }
  if (!resolved) {
    return (
      <main>
        {banner}
        <p>Loading your site…</p>
      </main>
    );
  }

  // Say when the root was assumed rather than read. 'pages' assumed nothing.
  const rootNote =
    resolved.layout.basis === 'pages' ? null : (
      <p class="banner warn">{describeAssumedRoot(resolved.layout.basis)}</p>
    );
  const scanNote =
    resolved.layout.postsScan === 'root-only' ? (
      <p class="banner warn">{MSG.treeTruncated}</p>
    ) : null;

  return (
    <main>
      {banner}
      {rootNote}
      {scanNote}
      {route.view === 'list' && <ListView gh={gh} storage={storage} resolved={resolved} />}
      {(route.view === 'edit' || route.view === 'new') && (
        <EditorView
          gh={gh}
          layout={resolved.layout}
          path={route.view === 'edit' ? route.path : null}
          onPublished={(target) => setPublishing(target)}
        />
      )}
    </main>
  );
}
