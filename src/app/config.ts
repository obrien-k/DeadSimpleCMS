// Repo identity (#2): the config line in index.html is authoritative when
// present, and a malformed line is a hard error with no client-side override —
// any override path recreates the hand-typed-line failure the installer
// exists to delete. Absent config (a dev page, a hand install) falls back to
// a first-run prompt whose answer lives in localStorage.
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseRepoConfig(value: string | null): string | null {
  if (value === null) return null;
  if (!REPO_RE.test(value)) {
    throw new ConfigError(
      `The repository config line ("${value}") is not owner/name. ` +
        'Re-run the installer rather than editing index.html by hand.',
    );
  }
  return value;
}

// The installer writes: <meta name="dscms:repo" content="owner/name">
export function readRepoConfig(doc: Pick<Document, 'querySelector'>): string | null {
  const meta = doc.querySelector('meta[name="dscms:repo"]');
  return parseRepoConfig(meta?.getAttribute('content') ?? null);
}
