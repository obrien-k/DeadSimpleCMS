import { useState } from 'preact/hooks';
import { parseRepoConfig, ConfigError } from '../config.js';
import { tokenTemplateUrl } from '../token.js';
import { MSG } from '../messages.js';

export interface SetupProps {
  configuredRepo: string | null;
  /** Returns an error message, or null on success. */
  onSubmit(token: string, repo: string): Promise<string | null>;
}

export function Setup({ configuredRepo, onSubmit }: SetupProps) {
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

  return (
    <main class="setup">
      <h1>DeadSimpleCMS</h1>
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
        {owner && (
          <p>
            <a href={tokenTemplateUrl(owner)} target="_blank" rel="noopener noreferrer">
              Create a token for this site →
            </a>
          </p>
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
          {busy ? 'Checking…' : 'Connect'}
        </button>
        {error && <p class="banner error">{error}</p>}
      </form>
    </main>
  );
}
