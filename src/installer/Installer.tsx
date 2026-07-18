import { useEffect, useState } from 'preact/hooks';
import { createClient } from '../gh/index.js';
import { parseRepoConfig, ConfigError, readRepoConfig } from '../app/config.js';
import { checkTokenFormat, tokenTemplateUrl } from '../app/token.js';
import { preflight, type Preflight } from './preflight.js';
import { buildInstallCommit } from './install.js';
import { watchInstall, type InstallOutcome } from './finish.js';
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

type Step = 'committing' | 'building';
type StepStatus = 'done' | 'active' | 'pending' | 'failed';
const MARK: Record<StepStatus, string> = { done: '✔', active: '◐', pending: '○', failed: '✖' };

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Phase =
  | { at: 'repo' }
  | { at: 'token' }
  | { at: 'checking' }
  | { at: 'result'; pre: Preflight }
  | { at: 'installing'; step: Step; startedAt: number }
  | { at: 'done'; outcome: InstallOutcome; url: string; repaired: boolean; buildType: 'legacy' | 'workflow' | null }
  | { at: 'error'; message: string };

export function Installer() {
  const [phase, setPhase] = useState<Phase>({ at: 'repo' });
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  // A 1s heartbeat so the elapsed clock advances while we wait on the build.
  const [, setNowTick] = useState(0);

  const owner = repo.split('/')[0] ?? '';
  const client = () => createClient({ token: token.trim(), repo: repo.trim() });

  useEffect(() => {
    if (phase.at !== 'installing' || phase.step !== 'building') return;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase.at, phase.at === 'installing' ? phase.step : '']);

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
    setPhase({ at: 'installing', step: 'committing', startedAt: Date.now() });
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

      // Watch the real Pages deployment; a timeout resolves 'building', never a
      // false 'live' (the old poll's 404-on-success bug).
      setPhase({ at: 'installing', step: 'building', startedAt: Date.now() });
      const outcome = await watchInstall(gh, sha);

      const repaired = pre.collision.kind === 'ours' || pre.collision.kind === 'ours-moved';
      setPhase({ at: 'done', outcome, url: pre.liveUrl, repaired, buildType: pre.buildType });
    } catch (e) {
      setPhase({ at: 'error', message: e instanceof Error ? e.message : String(e) });
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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitRepo();
              }}
            >
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
              <button type="submit">Continue →</button>
            </form>
          </section>
        );

      case 'token':
        return (
          <section>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitToken();
              }}
            >
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
              <button type="submit">Check &amp; continue →</button>
            </form>
          </section>
        );

      case 'checking':
        return <p>Checking <code>{repo}</code>…</p>;

      case 'result':
        return renderResult(phase.pre);

      case 'installing': {
        const committed: StepStatus = phase.step === 'committing' ? 'active' : 'done';
        const building: StepStatus = phase.step === 'building' ? 'active' : 'pending';
        const elapsed = phase.step === 'building' ? fmtElapsed(Date.now() - phase.startedAt) : '';
        return (
          <section>
            <h2>Installing your editor</h2>
            <ul class="steps">
              <li>{MARK[committed]} Committed</li>
              <li>
                {MARK[building]} Building your site{building === 'active' ? `…  ${elapsed}` : ''}
              </li>
              <li>{MARK.pending} Live</li>
            </ul>
            <p class="note">{IMSG.buildingStatus}</p>
          </section>
        );
      }

      case 'done':
        return renderDone(phase);

      case 'error':
        return (
          <section>
            <p class="banner error">{phase.message}</p>
            <button onClick={() => setPhase({ at: 'token' })}>← Back</button>
          </section>
        );
    }
  }

  function renderDone(p: Extract<Phase, { at: 'done' }>) {
    const live = p.outcome === 'live';
    const failed = p.outcome === 'failed';
    const buildMark: StepStatus = live ? 'done' : failed ? 'failed' : 'active';
    const liveMark: StepStatus = live ? 'done' : 'pending';
    return (
      <section>
        <ul class="steps">
          <li>{MARK.done} Committed</li>
          <li>{MARK[buildMark]} Building your site</li>
          <li>{MARK[liveMark]} Live</li>
        </ul>
        {live && (
          <>
            <p class="banner ok">
              ✓ {IMSG.liveAt('')}
              <a href={p.url}>{p.url}</a>
            </p>
            {p.repaired && <p class="note">{IMSG.repairedNote}</p>}
            <p>Open the link above to write your first post.</p>
          </>
        )}
        {p.outcome === 'building' && (
          <>
            <p class="banner">{IMSG.stillBuilding}</p>
            {p.buildType === 'workflow' && <p class="note">{IMSG.workflowWarning}</p>}
            <p>
              <a href={p.url}>{p.url}</a>
            </p>
          </>
        )}
        {failed && (
          <>
            <p class="banner error">{IMSG.buildFailed}</p>
            <p>
              <a href={p.url}>{p.url}</a>
            </p>
          </>
        )}
      </section>
    );
  }

  function renderResult(pre: Preflight) {
    if (!pre.ok) {
      const [message, extra] =
        pre.gate === 'unreachable'
          ? [IMSG.unreachable, null]
          : pre.gate === 'no-pages'
            ? [IMSG.noPages, null]
            : pre.gate === 'not-jekyll'
              ? [IMSG.notJekyll, null]
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
