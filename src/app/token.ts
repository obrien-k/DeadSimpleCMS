// Token first-use checks (#7): the general over-scope case is undecidable —
// the manual repository dropdown is the only enforcement point — so run only
// the decidable subset. The format check here is the free, offline one; the
// dangling-blob write probe lives on the gh client.
export type TokenCheck = { ok: true } | { ok: false; reason: 'classic' | 'empty' };

export function checkTokenFormat(token: string): TokenCheck {
  const t = token.trim();
  if (!t) return { ok: false, reason: 'empty' };
  // Classic tokens are all-repositories by construction; the prefix convicts
  // them offline, in zero API calls.
  if (t.startsWith('ghp_')) return { ok: false, reason: 'classic' };
  return { ok: true };
}

const TOKEN_KEY = 'dscms:token';
const REPO_KEY = 'dscms:repo';

type KVStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const tokenStore = {
  get: (s: KVStorage) => s.getItem(TOKEN_KEY),
  set: (s: KVStorage, token: string) => s.setItem(TOKEN_KEY, token.trim()),
  clear: (s: KVStorage) => s.removeItem(TOKEN_KEY),
};

export const repoStore = {
  get: (s: KVStorage) => s.getItem(REPO_KEY),
  set: (s: KVStorage, repo: string) => s.setItem(REPO_KEY, repo),
};

// The template URL that pre-fills the fine-grained token form (verified July
// 2026). The one step it cannot pre-fill is repository selection — that manual
// dropdown is the only scoping enforcement that exists, so the UI around this
// link must call it out loudly.
export function tokenTemplateUrl(owner: string): string {
  const params = new URLSearchParams({
    name: 'DeadSimpleCMS',
    description: 'Lets DeadSimpleCMS publish posts to your site',
    target_name: owner,
    // 365, not GitHub's 366 ceiling: an account/org "maximum lifetime" policy
    // capped at 365 rejects 366 outright ("greater than the allowed 365"). 365
    // is valid under both the default ceiling and a 365 cap, so it never trips.
    expires_in: '365',
    contents: 'write',
    actions: 'read',
    pages: 'read',
  });
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

// Where a returning user regenerates the token they already made (#30). A
// fine-grained token can't be deep-linked by id — GitHub doesn't put it in a
// URL we hold — so this lands them on the list to find "DeadSimpleCMS" and click
// Regenerate. The payoff over tokenTemplateUrl: the repository selection, the
// one field the template can't pre-fill, is preserved rather than re-picked.
export function tokenListUrl(): string {
  return 'https://github.com/settings/personal-access-tokens';
}
