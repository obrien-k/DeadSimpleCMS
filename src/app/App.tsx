import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { createClient, type GhClient } from '../gh/index.js';
import { LayoutError, resolveLayout, type Resolved } from '../layout/index.js';
import { parseRoute, type Route } from './router.js';
import { checkTokenFormat, repoStore, tokenStore } from './token.js';
import { describeAssumedRoot, MSG } from './messages.js';
import { Setup } from './views/Setup.js';
import { RenewLinks } from './views/RenewLinks.js';
import { ListView } from './views/List.js';
import { EditorView } from './views/Editor.js';
import { PublishView, type PublishTarget } from './views/Publish.js';
import { UnpublishView, type UnpublishTarget } from './views/Unpublish.js';

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
  const [unpublishing, setUnpublishing] = useState<UnpublishTarget | null>(null);
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  // Set when a live call 401s (#30). Holds the last-seen expiry when that date
  // is already past (→ "expired on <date>"), or null when the 401 struck inside
  // the token's window (revoked / repo-deselected → generic re-auth copy).
  const [authExpired, setAuthExpired] = useState<{ at: Date | null } | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const repo = configuredRepo ?? promptedRepo;

  // Stable so the client memo below keys only on token/repo. setState is stable,
  // so the empty dep list is honest.
  const onAuthError = useCallback((expiry: Date | null) => {
    setAuthExpired({ at: expiry && expiry.getTime() < Date.now() ? expiry : null });
  }, []);

  useEffect(() => {
    const onHash = () => {
      setPublishing(null);
      setUnpublishing(null);
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
    () => (token && repo ? createClient({ token, repo, onAuthError }) : null),
    [token, repo, onAuthError],
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

  // Shared by first-run and the #30 re-auth screen: validate, probe (a bare
  // client with no onAuthError, so a bad new token shows probeFailed inline
  // rather than re-triggering the takeover), then take the token. Clearing
  // authExpired on success is a no-op at first run and the exit from re-auth.
  const connect = async (tok: string, rep: string): Promise<string | null> => {
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
    setAuthExpired(null);
    return null;
  };

  // The token of an established session went dead: everything is broken, so a
  // banner over a half-rendered view would lie. Take over with the token form,
  // pre-scoped to the known repo. Rendered before the first-run check because a
  // dead token can 401 while gh still exists.
  if (authExpired && repo) {
    return <Setup configuredRepo={repo} onSubmit={connect} reauth expiredOn={authExpired.at} />;
  }

  if (!gh || !repo) {
    return <Setup configuredRepo={configuredRepo} onSubmit={connect} />;
  }

  const banner =
    expiryDays !== null && expiryDays <= 30 ? (
      <div class="banner warn">
        <p>{MSG.expiryWarning(Math.max(expiryDays, 0))}</p>
        <RenewLinks owner={repo.split('/')[0] ?? ''} />
      </div>
    ) : null;

  if (publishing) {
    return (
      <main>
        {banner}
        <PublishView gh={gh} target={publishing} onDone={() => (location.hash = '#/')} />
      </main>
    );
  }

  if (unpublishing) {
    return (
      <main>
        {banner}
        <UnpublishView gh={gh} target={unpublishing} onDone={() => (location.hash = '#/')} />
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
          resolved={resolved}
          storage={storage}
          path={route.view === 'edit' ? route.path : null}
          onPublished={(target) => setPublishing(target)}
          onUnpublished={(target) => setUnpublishing(target)}
        />
      )}
    </main>
  );
}
