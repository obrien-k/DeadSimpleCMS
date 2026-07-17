import { diffLines, type DiffLine } from '../diff.js';
import { MSG } from '../messages.js';

export interface ConflictProps {
  /** The writer's version — what they tried to save. */
  mine: string;
  /** What is now on GitHub. */
  theirs: string;
  busy: boolean;
  error?: string | null;
  onKeepMine(): void;
  onUseTheirs(): void;
  onSaveCopy(): void;
  onCancel(): void;
}

// Variant B (#15), chosen over the escape-only and line-by-line options: show
// both versions side by side with the differing lines shaded, then ask for one
// decision — keep mine or use theirs — with "save mine as a copy" as the door
// out that loses nothing. Whole-file compare, so a changed title and a changed
// body line both surface. Styling is inline so it ships in the bundle and does
// not depend on the installer-owned index.html carrying new classes.
function Column({ heading, lines, shade }: { heading: string; lines: DiffLine[]; shade: string }) {
  return (
    <div>
      <h3 style="margin:.2rem 0;font-size:.9rem">{heading}</h3>
      <div style="border:1px solid #d0d7de;border-radius:4px;padding:.5rem;overflow:auto;background:#fafafa;font-family:ui-monospace,monospace;font-size:.85rem;white-space:pre-wrap">
        {lines.map((l, i) => (
          <div key={i} style={l.changed ? `background:${shade}` : ''}>
            {l.text || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConflictView({
  mine,
  theirs,
  busy,
  error,
  onKeepMine,
  onUseTheirs,
  onSaveCopy,
  onCancel,
}: ConflictProps) {
  const d = diffLines(mine, theirs);
  return (
    <div class="editor">
      <div class="banner error">
        {MSG.conflict} Compare the two versions and choose which to keep — the shaded
        lines are the ones that differ.
      </div>
      {error && <p class="banner error">{error}</p>}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1rem 0">
        <Column heading="Your version" lines={d.mine} shade="#ddf4ff" />
        <Column heading="Now on GitHub" lines={d.theirs} shade="#ffebe9" />
      </div>
      <p>
        <button type="button" class="primary" disabled={busy} onClick={onKeepMine}>
          Keep mine (replaces the GitHub version)
        </button>
        <button type="button" disabled={busy} onClick={onUseTheirs}>
          Use theirs (discards my changes)
        </button>
      </p>
      <p class="note">
        Not ready to choose?{' '}
        <button type="button" disabled={busy} onClick={onSaveCopy}>
          Save mine as a separate draft
        </button>{' '}
        or{' '}
        <button type="button" disabled={busy} onClick={onCancel}>
          keep editing
        </button>
        . Nothing is lost either way.
      </p>
    </div>
  );
}
