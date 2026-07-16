// PROTOTYPE — throwaway. Answers: can a fine-grained PAT with contents:write
// perform an atomic multi-file move via the Git Data API? See NOTES.md.
//
// Uses plain fetch against api.github.com — no Octokit — because the real app
// is a static page with a ~100 kB budget and would do exactly this.

const API = 'https://api.github.com';

export class Api {
  constructor(token, repo) {
    this.token = token;
    this.repo = repo; // "owner/name"
    this.calls = 0;
  }

  async req(method, path, body) {
    this.calls++;
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status}: ${data?.message ?? text}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // --- reads ---
  getRef(branch) {
    return this.req('GET', `/repos/${this.repo}/git/ref/heads/${branch}`);
  }
  getCommit(sha) {
    return this.req('GET', `/repos/${this.repo}/git/commits/${sha}`);
  }
  getTree(sha, recursive = true) {
    return this.req('GET', `/repos/${this.repo}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`);
  }
  async getBlobText(sha) {
    const b = await this.req('GET', `/repos/${this.repo}/git/blobs/${sha}`);
    // base64 -> bytes -> utf8. Never atob(): it mangles non-ASCII.
    const bytes = Uint8Array.from(atob(b.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // --- writes ---
  createBlob(text) {
    // utf8 -> bytes -> base64. Same reason as above, in reverse.
    const bytes = new TextEncoder().encode(text);
    const b64 = btoa(String.fromCharCode(...bytes));
    return this.req('POST', `/repos/${this.repo}/git/blobs`, { content: b64, encoding: 'base64' });
  }
  createTree(baseTree, tree) {
    return this.req('POST', `/repos/${this.repo}/git/trees`, { base_tree: baseTree, tree });
  }
  createCommit(message, treeSha, parents) {
    return this.req('POST', `/repos/${this.repo}/git/commits`, { message, tree: treeSha, parents });
  }
  updateRef(branch, sha, force = false) {
    return this.req('PATCH', `/repos/${this.repo}/git/refs/heads/${branch}`, { sha, force });
  }
}

// Move a file and edit its content in ONE commit.
//
// The move is expressed as a tree delta over base_tree: the new path is added
// and the old path is tombstoned with sha:null. Both land in a single commit
// object, so there is no window where the site has two copies of the post.
export async function atomicMove(api, branch, { from, to, content, message, expectedHeadSha }) {
  const ref = await api.getRef(branch);
  const head = ref.object.sha;

  // Compare-and-swap: refuse if someone else moved HEAD since we read it.
  if (expectedHeadSha && head !== expectedHeadSha) {
    const e = new Error('conflict: HEAD moved since read');
    e.conflict = true;
    throw e;
  }

  const headCommit = await api.getCommit(head);
  const blob = await api.createBlob(content);

  const tree = await api.createTree(headCommit.tree.sha, [
    { path: to, mode: '100644', type: 'blob', sha: blob.sha },
    { path: from, mode: '100644', type: 'blob', sha: null }, // tombstone = delete
  ]);

  const commit = await api.createCommit(message, tree.sha, [expectedHeadSha ?? head]);
  await api.updateRef(branch, commit.sha); // force:false → server-side CAS
  return commit;
}
