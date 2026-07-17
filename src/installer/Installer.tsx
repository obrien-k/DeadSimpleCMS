import { useState } from 'preact/hooks';
import { createClient } from '../gh/index.js';
import { parseRepoConfig, ConfigError, readRepoConfig } from '../app/config.js';
import { checkTokenFormat, tokenTemplateUrl } from '../app/token.js';
import { preflight, type Preflight } from './preflight.js';
import { buildInstallCommit } from './install.js';
import { IMSG } from './messages.js';

// dscms:repo out of an existing admin/index.html, using the browser DOM and the
// app's own reader so the marker contract lives in exactly one place (config.ts).
function extractRepoMeta(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  try {
    return readRepoConfig(doc);
  } catch (e) {
    // A malformed marker in someone else's file is not our config error — treat
    // it as "not ours" rather than crashing the installer.
    if (e instanceof ConfigError) return null;
    throw e;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Phase =
  | { at: 'repo' }
  | { at: 'token' }
  | { at: 'checking' }
  | { at: 'result'; pre: Preflight }
  | { at: 'installing'; note: string }
  | { at: 'done'; url: string; repaired: boolean }
  | { at: 'error'; message: string };

export function Installer() {
  const [phase, setPhase] = useState<Phase>({ at: 'repo' });
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);

  const owner = repo.split('/')[0] ?? '';
  const client = () => createClient({ token: token.trim(), repo: repo.trim() });

  async function runPreflight() {
    setPhase({ at: 'checking' });
    try {
      const pre = await preflight(client(), repo.trim(), { extractRepoMeta });
      setPhase({ at: 'result', pre });
    } catch (e) {
      setPhase({ at: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  function submitRepo() {
    try {
      parseRepoConfig(repo.trim());
    } catch {
      setTokenError(IMSG.repoMalformed);
      return;
    }
    setTokenError(null);
    setPhase({ at: 'token' });
  }

  function submitToken() {
    const fmt = checkTokenFormat(token);
    if (!fmt.ok) {
      setTokenError(fmt.reason === 'classic' ? IMSG.shared.classicToken : IMSG.shared.emptyToken);
      return;
    }
    setTokenError(null);
    void runPreflight();
  }

  async function install(pre: Extract<Preflight, { ok: true }>) {
    setPhase({ at: 'installing', note: IMSG.installing });
    try {
      const gh = client();
      // Both payloads are served same-origin beside this installer, so the
      // installer always writes the exact version it shipped with.
      const [bundle, indexTemplate] = await Promise.all([
        fetch('./bundle.js').then((r) => r.text()),
        fetch('./admin-template.html').then((r) => r.text()),
      ]);
      const commit = buildInstallCommit(pre.branch, {
        adminPrefix: pre.adminPrefix,
        targetRepo: repo.trim(),
        indexTemplate,
        bundle,
        collisionKind: pre.collision.kind,
      });
      const { sha } = await gh.commit(commit);

      setPhase({ at: 'installing', note: IMSG.publishing });
      await watchBuild(gh, sha);

      const repaired = pre.collision.kind === 'ours' || pre.collision.kind === 'ours-moved';
      setPhase({ at: 'done', url: pre.liveUrl, repaired });
    } catch (e) {
      setPhase({ at: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Bounded poll — the finish line is the promise, but we don't hang forever if
  // Pages is slow. Either outcome ends on the live link; a slow build just says
  // so rather than spinning.
  async function watchBuild(gh: ReturnType<typeof createClient>, sha: string) {
    for (let i = 0; i < 18; i++) {
      const state = await gh.getBuildState(sha).catch(() => null);
      if (state?.status === 'completed') return;
      await sleep(5000);
    }
  }

  return <div>{renderPhase()}</div>;

  function renderPhase() {
    switch (phase.at) {
      case 'repo':
        return (
          <section>
            <p>{IMSG.landingBody}</p>
            <p class="note">{IMSG.landingNeeds}</p>
            <label>
              {IMSG.repoLabel}
              <input
                value={repo}
                placeholder="you/your-site"
                onInput={(e) => setRepo((e.target as HTMLInputElement).value)}
              />
            </label>
            <p class="note">{IMSG.repoWhyTyped}</p>
            {tokenError && <p class="banner error">{tokenError}</p>}
            <button onClick={submitRepo}>Continue →</button>
          </section>
        );

      case 'token':
        return (
          <section>
            <p>
              Create a fine-grained token so this editor can publish to <code>{repo}</code>. The
              link pre-fills everything it can:
            </p>
            <p>
              <a href={tokenTemplateUrl(owner)} target="_blank" rel="noopener noreferrer">
                Create a token for this site →
              </a>
            </p>
            <p class="callout">{IMSG.shared.dropdownCallout(repo)}</p>
            <label>
              Paste the token
              <input
                type="password"
                value={token}
                placeholder="github_pat_…"
                onInput={(e) => setToken((e.target as HTMLInputElement).value)}
              />
            </label>
            {tokenError && <p class="banner error">{tokenError}</p>}
            <button onClick={submitToken}>Check &amp; continue →</button>
          </section>
        );

      case 'checking':
        return <p>Checking <code>{repo}</code>…</p>;

      case 'result':
        return renderResult(phase.pre);

      case 'installing':
        return <p>{phase.note}</p>;

      case 'done':
        return (
          <section>
            <p class="banner ok">
              ✓ {IMSG.liveAt('')}
              <a href={phase.url}>{phase.url}</a>
            </p>
            {phase.repaired && <p class="note">{IMSG.repairedNote}</p>}
            <p>Open the link above to write your first post.</p>
          </section>
        );

      case 'error':
        return (
          <section>
            <p class="banner error">{phase.message}</p>
            <button onClick={() => setPhase({ at: 'token' })}>← Back</button>
          </section>
        );
    }
  }

  function renderResult(pre: Preflight) {
    if (!pre.ok) {
      const [message, extra] =
        pre.gate === 'unreachable'
          ? [IMSG.unreachable, null]
          : pre.gate === 'no-pages'
            ? [IMSG.noPages, null]
            : [IMSG.insecure, IMSG.insecureIsDefault];
      return (
        <section>
          <p class="banner error">{message}</p>
          {extra && <p class="note">{extra}</p>}
          <button onClick={() => void runPreflight()}>Re-check</button>
          <button onClick={() => setPhase({ at: 'token' })}>← Back</button>
        </section>
      );
    }

    const k = pre.collision.kind;
    const heading = <h2>{IMSG.collisionHeading(k)}</h2>;
    const warnings = (
      <>
        {pre.buildType === 'workflow' && <p class="note">{IMSG.workflowWarning}</p>}
        {pre.truncated && <p class="note">{IMSG.truncatedWarning}</p>}
      </>
    );

    if (k === 'unknown-index') {
      return (
        <section>
          {heading}
          <p class="banner error">{IMSG.unknownIndex}</p>
          <button onClick={() => setPhase({ at: 'repo' })}>Start over</button>
        </section>
      );
    }

    if (k === 'decap') {
      return (
        <section>
          {heading}
          <p class="banner">{IMSG.decap}</p>
          <p class="note">{IMSG.decapFromDecap}</p>
          {warnings}
          <button onClick={() => void install(pre)}>Replace admin/index.html and install →</button>
          <button onClick={() => setPhase({ at: 'repo' })}>Cancel</button>
        </section>
      );
    }

    const body =
      k === 'ours' ? (
        <p class="callout">{IMSG.ours}</p>
      ) : k === 'ours-moved' ? (
        <p class="callout">{IMSG.oursMoved(repo)}</p>
      ) : k === 'unknown-safe' ? (
        <p class="callout">{IMSG.unknownSafe}</p>
      ) : null;
    const cta = k === 'ours' || k === 'ours-moved' ? 'Repair →' : 'Install →';

    return (
      <section>
        {heading}
        {body}
        {warnings}
        <button onClick={() => void install(pre)}>{cta}</button>
      </section>
    );
  }
}
