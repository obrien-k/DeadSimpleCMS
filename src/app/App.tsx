import { useEffect, useMemo, useState } from 'preact/hooks';
import { createClient, type GhClient } from '../gh/index.js';
import { parseRoute, type Route } from './router.js';
import { checkTokenFormat, repoStore, tokenStore } from './token.js';
import { MSG } from './messages.js';
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

  const repo = configuredRepo ?? promptedRepo;

  useEffect(() => {
    const onHash = () => {
      setPublishing(null);
      setRoute(parseRoute(location.hash));
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

  return (
    <main>
      {banner}
      {route.view === 'list' && <ListView gh={gh} storage={storage} onLoaded={refreshExpiry} />}
      {(route.view === 'edit' || route.view === 'new') && (
        <EditorView
          gh={gh}
          path={route.view === 'edit' ? route.path : null}
          onPublished={(target) => setPublishing(target)}
        />
      )}
    </main>
  );
}
