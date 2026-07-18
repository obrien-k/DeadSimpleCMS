import { useState } from 'preact/hooks';
import { parseRepoConfig, ConfigError } from '../config.js';
import { tokenTemplateUrl } from '../token.js';
import { MSG } from '../messages.js';
import { RenewLinks } from './RenewLinks.js';

export interface SetupProps {
  configuredRepo: string | null;
  /** Returns an error message, or null on success. */
  onSubmit(token: string, repo: string): Promise<string | null>;
  // Re-auth mode (#30): the session had a working token that went dead. The repo
  // is already known, so only the token is re-asked — with expiry-aware copy and
  // both renewal links. `expiredOn` is the last-seen expiry, or null when the
  // 401 came from inside the token's window (revoked / repo-deselected).
  reauth?: boolean;
  expiredOn?: Date | null;
}

export function Setup({ configuredRepo, onSubmit, reauth, expiredOn }: SetupProps) {
  const [repoInput, setRepoInput] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const repo = configuredRepo ?? repoInput;
  const owner = repo.split('/')[0] ?? '';

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    let rep: string;
    try {
      rep = parseRepoConfig(repo.trim()) ?? '';
    } catch (err) {
      setError(err instanceof ConfigError ? 'Repository must look like owner/name.' : String(err));
      return;
    }
    setBusy(true);
    try {
      setError(await onSubmit(token, rep));
    } finally {
      setBusy(false);
    }
  };

  const expiredOnText =
    expiredOn && !Number.isNaN(expiredOn.getTime())
      ? expiredOn.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : null;

  return (
    <main class="setup">
      <h1>DeadSimpleCMS</h1>
      {reauth && <p class="banner warn">{MSG.tokenExpired(expiredOnText)}</p>}
      <form onSubmit={submit}>
        {!configuredRepo && (
          <label>
            Your site repository (owner/name)
            <input
              value={repoInput}
              onInput={(e) => setRepoInput((e.target as HTMLInputElement).value)}
              placeholder="you/your-site"
            />
          </label>
        )}
        {/* First run offers one link (there is no prior token to regenerate);
            re-auth offers both, since a returning user usually has one. */}
        {reauth ? (
          owner && <RenewLinks owner={owner} />
        ) : (
          owner && (
            <p>
              <a href={tokenTemplateUrl(owner)} target="_blank" rel="noopener noreferrer">
                Create a token for this site →
              </a>
            </p>
          )
        )}
        {repo && <p class="callout">{MSG.dropdownCallout(repo)}</p>}
        <label>
          Paste the token
          <input
            type="password"
            value={token}
            onInput={(e) => setToken((e.target as HTMLInputElement).value)}
            placeholder="github_pat_…"
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Checking…' : reauth ? 'Reconnect' : 'Connect'}
        </button>
        {error && <p class="banner error">{error}</p>}
      </form>
    </main>
  );
}
