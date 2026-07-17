// GitHub API client: plain fetch, no Octokit (bundle budget), covering the two
// API surfaces phase 1 needs — REST for Git Data / Contents / Pages /
// Deployments, GraphQL for listing. One request helper handles both error
// shapes: REST fails with a status, GraphQL fails inside an HTTP 200 (an
// `errors` array), so a bare res.ok check would read success from a failure.
const API = 'https://api.github.com';

/** The largest aliased blob query with evidence behind it: #5 verified 102 on a real site. */
const BLOB_BATCH = 100;

const chunk = <T>(xs: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, i * size + size));

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

export interface PathQuery {
  /** Explicit: the branch Pages builds is not always the repo default (#17). */
  branch: string;
  /** Paths to read as trees. */
  dirs?: string[];
  /** Paths to read as file text. */
  files?: string[];
}

export interface PathResult {
  /** Keyed by the path asked for. `null` = no such path, which is normal. */
  dirs: Map<string, Entry[] | null>;
  files: Map<string, string | null>;
}

/** One path in a whole-repo tree read. `sha` on a blob IS the GraphQL oid, so the oid-keyed cache reads the same either way. */
export interface TreeFile {
  path: string;
  sha: string;
}

export interface TreeResult {
  /** Blobs only; directories are implied by the paths. */
  files: TreeFile[];
  /** GitHub silently returns a PARTIAL tree above ~100k entries / 7 MB. Ignoring this ships omission with no symptom (#18). */
  truncated: boolean;
}

export interface BlobResult {
  text: string | null;
  isBinary: boolean;
  isTruncated: boolean;
}

export interface CommitInput {
  message: string;
  // A string is UTF-8 text (posts); a Uint8Array is binary (an uploaded image),
  // base64'd straight rather than pushed through TextEncoder, which would
  // corrupt any non-UTF-8 byte (#14).
  changes?: { path: string; content: string | Uint8Array }[];
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

export interface PagesSource {
  /** The branch Pages builds — NOT necessarily the repo's default branch. */
  branch: string;
  /** Jekyll's source root within the branch: "/" or "/docs". */
  path: string;
}

export interface PagesInfo {
  html_url: string;
  status: string | null;
  https_enforced?: boolean;
  // #17: `source` and `build_type` were in this response all along and thrown
  // away, which is how `HEAD:_posts` survived. Both are documented fields.
  source?: PagesSource;
  /** "legacy" = branch build (source is authoritative); "workflow" = Actions builds it, so source describes a setting that is not in play. */
  build_type?: 'legacy' | 'workflow' | null;
}

export interface RepoInfo {
  default_branch: string;
  /** GET /pages 404s on a private repo unless the token carries Pages:read, and a 404 is indistinguishable from "Pages is off" — so this is what keeps that message honest (#17). */
  private: boolean;
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
  let repoInfo: RepoInfo | null = null;

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

    // Memoized per session: both fields are read on every load (#17's layout
    // resolution) and neither changes under a running app.
    async getRepo(): Promise<RepoInfo> {
      if (!repoInfo) repoInfo = await rest<RepoInfo>('GET', `/repos/${repo}`);
      return repoInfo;
    },

    async getDefaultBranch(): Promise<string> {
      return (await this.getRepo()).default_branch;
    },

    // Batch tree/file reads at one commit-ish, one query. Deliberately knows
    // nothing about Jekyll: it took `HEAD:_posts` being hardcoded here to hide
    // #17 for a whole phase, so the caller names every path and this only
    // fetches. `branch` is explicit for the same reason — `HEAD` silently meant
    // "the default branch", which is not necessarily the branch Pages builds.
    //
    // Lean on purpose: `text` is asked for only where the caller wants a file,
    // never for listing entries (~17× the bytes to refill an almost-always-warm
    // cache). A missing path is `object: null`, which is normal, not an error.
    async queryPaths({ branch, dirs = [], files = [] }: PathQuery): Promise<PathResult> {
      const out: PathResult = { dirs: new Map(), files: new Map() };
      if (dirs.length === 0 && files.length === 0) return out;

      const expr = (p: string) => JSON.stringify(`${branch}:${p}`);
      const aliases = [
        ...dirs.map(
          (p, i) => `d${i}: object(expression: ${expr(p)}) { ... on Tree { entries { name oid } } }`,
        ),
        ...files.map(
          (p, i) => `f${i}: object(expression: ${expr(p)}) { ... on Blob { text isTruncated } }`,
        ),
      ].join('\n');

      const data = await graphql<{
        repository: Record<string, { entries?: Entry[]; text?: string | null; isTruncated?: boolean } | null>;
      }>(
        `query($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {\n${aliases}\n}
        }`,
        { owner, name },
      );

      dirs.forEach((p, i) => out.dirs.set(p, data.repository[`d${i}`]?.entries ?? null));
      files.forEach((p, i) => {
        const b = data.repository[`f${i}`];
        // A truncated blob is a lie by omission — better to report absence than
        // to parse half a config file.
        out.files.set(p, b && !b.isTruncated ? (b.text ?? null) : null);
      });
      return out;
    },

    // Whole-repo paths in one call. Jekyll reads `_posts`/`_drafts` from every
    // directory at any depth (#18), which no fixed set of aliases can express —
    // and a GraphQL nesting depth would be a limit we invented, i.e. #17's
    // silent omission in a new hat. REST spends a different quota (5,000/hr)
    // than GraphQL's points, so this does not crowd out the blob fetch.
    async getTree(branch: string): Promise<TreeResult> {
      const data = await rest<{
        tree: { path: string; type: string; sha: string }[];
        truncated?: boolean;
      }>('GET', `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      return {
        files: data.tree.filter((e) => e.type === 'blob').map(({ path, sha }) => ({ path, sha })),
        truncated: data.truncated === true,
      };
    },

    // Phase-2: cache misses only, blobs addressed directly by oid. Aliased oid
    // lookups don't count against the node limit (verified to 102 in one query).
    async fetchBlobs(oids: string[]): Promise<Map<string, BlobResult>> {
      if (oids.length === 0) return new Map();
      // Chunked because the caller's size is no longer bounded by a directory:
      // #5 verified one aliased query to 102 blobs when the only callers were
      // _posts and _drafts, but #12's page candidates are every markdown file
      // under the source root, which a docs-heavy site counts in thousands.
      // Where an aliased query actually breaks is unmeasured, so this stays at
      // the size that has evidence behind it rather than probing for the cliff.
      // Chunks are parallel: cold start costs round trips, not sequence.
      const batches = await Promise.all(
        chunk(oids, BLOB_BATCH).map(async (batch) => {
          const aliases = batch
            .map(
              (oid, i) =>
                `b${i}: object(oid: "${oid}") { ... on Blob { text isBinary isTruncated } }`,
            )
            .join('\n');
          const data = await graphql<{ repository: Record<string, BlobResult | null> }>(
            `query { repository(owner: "${owner}", name: "${name}") {\n${aliases}\n} }`,
          );
          return batch.map((oid, i) => [oid, data.repository[`b${i}`]] as const);
        }),
      );
      const map = new Map<string, BlobResult>();
      for (const [oid, blob] of batches.flat()) if (blob) map.set(oid, blob);
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
        const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
        const blob = await rest<{ sha: string }>('POST', `/repos/${repo}/git/blobs`, {
          content: bytesToBase64(bytes),
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
