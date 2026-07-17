// GitHub API client: plain fetch, no Octokit (bundle budget), covering the two
// API surfaces phase 1 needs — REST for Git Data / Contents / Pages /
// Deployments, GraphQL for listing. One request helper handles both error
// shapes: REST fails with a status, GraphQL fails inside an HTTP 200 (an
// `errors` array), so a bare res.ok check would read success from a failure.
const API = 'https://api.github.com';

export class GhError extends Error {
  status: number;
  conflict: boolean;

  constructor(message: string, status: number, conflict = false) {
    super(message);
    this.name = 'GhError';
    this.status = status;
    this.conflict = conflict;
  }
}

export interface Entry {
  name: string;
  oid: string;
}

export interface Listing {
  posts: Entry[];
  drafts: Entry[];
}

export interface BlobResult {
  text: string | null;
  isBinary: boolean;
  isTruncated: boolean;
}

export interface CommitInput {
  message: string;
  changes?: { path: string; content: string }[];
  deletions?: string[];
  /** HEAD sha read when the file was opened; refuse to write if it moved. */
  expectedHeadSha?: string;
  branch?: string;
}

export interface Deployment {
  id: number;
  sha: string;
  environment: string;
}

export interface DeploymentStatus {
  state: string;
  environment_url?: string;
}

export interface PagesInfo {
  html_url: string;
  status: string | null;
  https_enforced?: boolean;
}

// btoa(String.fromCharCode(...bytes)) overflows the stack on large files;
// chunk the conversion. Never bare atob/btoa on content — they mangle
// non-ASCII, silently, and only for some users.
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToText(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface ClientOptions {
  token: string;
  /** "owner/name" */
  repo: string;
  fetch?: typeof fetch;
}

export function createClient({ token, repo, fetch: fetchImpl = fetch }: ClientOptions) {
  const [owner, name] = repo.split('/');
  let expiry: Date | null = null;
  let defaultBranch: string | null = null;

  async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const exp = res.headers.get('github-authentication-token-expiration');
    if (exp) {
      const d = new Date(exp.replace(' UTC', 'Z').replace(' ', 'T'));
      if (!Number.isNaN(d.getTime())) expiry = d;
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = (data as { message?: string } | null)?.message ?? text;
      throw new GhError(
        `${method} ${path} → ${res.status}: ${message}`,
        res.status,
        res.status === 422 && /fast forward/i.test(message),
      );
    }
    return data as T;
  }

  async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetchImpl(`${API}/graphql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
    });
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    // GraphQL's trap: errors arrive as HTTP 200 with an `errors` array.
    if (!res.ok || body.errors?.length) {
      const message = body.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`;
      throw new GhError(`graphql → ${message}`, res.status);
    }
    return body.data as T;
  }

  return {
    tokenExpiry: () => expiry,

    getRepo() {
      return rest<{ default_branch: string }>('GET', `/repos/${repo}`);
    },

    async getDefaultBranch(): Promise<string> {
      if (!defaultBranch) defaultBranch = (await this.getRepo()).default_branch;
      return defaultBranch;
    },

    // Phase-1 listing: the only call in steady state. Lean on purpose — asking
    // for `text` here costs ~17× the bytes to refill an almost-always-warm
    // cache. A missing directory is `object: null`, which is normal.
    async listEntries(): Promise<Listing> {
      type Dir = { entries: Entry[] } | null;
      const data = await graphql<{ repository: { posts: Dir; drafts: Dir } }>(
        `query($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            posts: object(expression: "HEAD:_posts") { ... on Tree { entries { name oid } } }
            drafts: object(expression: "HEAD:_drafts") { ... on Tree { entries { name oid } } }
          }
        }`,
        { owner, name },
      );
      return {
        posts: data.repository.posts?.entries ?? [],
        drafts: data.repository.drafts?.entries ?? [],
      };
    },

    // Phase-2: cache misses only, blobs addressed directly by oid. Aliased oid
    // lookups don't count against the node limit (verified to 102 in one query).
    async fetchBlobs(oids: string[]): Promise<Map<string, BlobResult>> {
      if (oids.length === 0) return new Map();
      const aliases = oids
        .map(
          (oid, i) =>
            `b${i}: object(oid: "${oid}") { ... on Blob { text isBinary isTruncated } }`,
        )
        .join('\n');
      const data = await graphql<{ repository: Record<string, BlobResult | null> }>(
        `query { repository(owner: "${owner}", name: "${name}") {\n${aliases}\n} }`,
      );
      const map = new Map<string, BlobResult>();
      oids.forEach((oid, i) => {
        const b = data.repository[`b${i}`];
        if (b) map.set(oid, b);
      });
      return map;
    },

    // Single-file read (editor open). Contents API; its 1 MB inline ceiling
    // applies only here — listing never touches it.
    async readFile(path: string): Promise<{ text: string; sha: string }> {
      const data = await rest<{ content: string; sha: string }>(
        'GET',
        `/repos/${repo}/contents/${path}`,
      );
      return { text: base64ToText(data.content), sha: data.sha };
    },

    // HEAD at open time — the value the editor passes back as expectedHeadSha
    // so a save can refuse when someone else published in between.
    async getHeadSha(branch?: string): Promise<string> {
      const br = branch ?? (await this.getDefaultBranch());
      const ref = await rest<{ object: { sha: string } }>(
        'GET',
        `/repos/${repo}/git/ref/heads/${br}`,
      );
      return ref.object.sha;
    },

    // Atomic multi-file commit via the Git Data API. Publish is a move: one
    // change plus one deletion in the same tree, one commit, one build — never
    // an intermediate state with two copies of the post live.
    async commit({ message, changes = [], deletions = [], expectedHeadSha, branch }: CommitInput) {
      const br = branch ?? (await this.getDefaultBranch());
      const ref = await rest<{ object: { sha: string } }>(
        'GET',
        `/repos/${repo}/git/ref/heads/${br}`,
      );
      const head = ref.object.sha;
      if (expectedHeadSha && head !== expectedHeadSha) {
        throw new GhError('conflict: HEAD moved since read', 409, true);
      }

      const headCommit = await rest<{ tree: { sha: string } }>(
        'GET',
        `/repos/${repo}/git/commits/${head}`,
      );

      const tree: { path: string; mode: string; type: string; sha: string | null }[] = [];
      for (const { path, content } of changes) {
        const blob = await rest<{ sha: string }>('POST', `/repos/${repo}/git/blobs`, {
          content: bytesToBase64(new TextEncoder().encode(content)),
          encoding: 'base64',
        });
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      for (const path of deletions) {
        tree.push({ path, mode: '100644', type: 'blob', sha: null }); // tombstone = delete
      }

      const newTree = await rest<{ sha: string }>('POST', `/repos/${repo}/git/trees`, {
        base_tree: headCommit.tree.sha,
        tree,
      });
      const commit = await rest<{ sha: string }>('POST', `/repos/${repo}/git/commits`, {
        message,
        tree: newTree.sha,
        parents: [head],
      });
      // force:false is the entire concurrency safety property — the server
      // rejects a non-fast-forward update with 422. Never pass true.
      await rest('PATCH', `/repos/${repo}/git/refs/heads/${br}`, {
        sha: commit.sha,
        force: false,
      });
      return { sha: commit.sha };
    },

    // 404 = Pages is not configured — categorically distinct from "the
    // deployment hasn't registered yet". Check before polling anything.
    async getPages(): Promise<PagesInfo | null> {
      try {
        return await rest<PagesInfo>('GET', `/repos/${repo}/pages`);
      } catch (e) {
        if (e instanceof GhError && e.status === 404) return null;
        throw e;
      }
    },

    async getDeployment(sha: string): Promise<Deployment | null> {
      const list = await rest<Deployment[]>(
        'GET',
        `/repos/${repo}/deployments?sha=${sha}&environment=github-pages`,
      );
      return list[0] ?? null;
    },

    getDeploymentStatuses(id: number): Promise<DeploymentStatus[]> {
      return rest<DeploymentStatus[]>('GET', `/repos/${repo}/deployments/${id}/statuses`);
    },

    // First-use writability probe: a dangling blob referenced by no tree, so
    // it is garbage-collected. Wrong repo, unscoped token, and missing
    // contents:write all 404 alike — GitHub refuses the distinction on
    // purpose, so report one message, not three.
    async probeWrite(): Promise<boolean> {
      try {
        await rest('POST', `/repos/${repo}/git/blobs`, {
          content: 'RGVhZFNpbXBsZUNNUyB3cml0ZSBwcm9iZQ==',
          encoding: 'base64',
        });
        return true;
      } catch (e) {
        if (e instanceof GhError && (e.status === 404 || e.status === 403)) return false;
        throw e;
      }
    },
  };
}

export type GhClient = ReturnType<typeof createClient>;
