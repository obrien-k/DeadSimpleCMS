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
    expires_in: '366',
    contents: 'write',
    actions: 'read',
    pages: 'read',
  });
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}
