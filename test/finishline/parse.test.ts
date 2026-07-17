import { describe, expect, it } from 'vitest';
import { parseBuildFailure } from '../../src/finishline/index.js';

// The raw job log is the only complete source (#9): the check-run annotation is
// truncated at 4096 chars and Jekyll's debug log buries the error before then.
// The log carries ANSI colour codes and per-line ISO timestamps, so the parser
// has to see through both. These fixtures are real lines from the scratch rig.
const ANSI = '[31m';
const RESET = '[0m';

describe('parseBuildFailure: pulling the one line that matters out of the log', () => {
  it('extracts file, line, and message from a Liquid syntax error', () => {
    const log = [
      '2026-07-17T16:15:58Z Reading: _posts/2026-07-17-break9.md',
      `2026-07-17T16:15:59.39Z ${ANSI}  Liquid Exception: Liquid syntax error (line 2): 'if' tag was never closed in /github/workspace/_posts/2026-07-17-break9.md${RESET}`,
      "2026-07-17T16:15:59.39Z /usr/local/bundle/gems/liquid-4.0.4/lib/liquid/block.rb:63:in `block in parse_body'",
    ].join('\n');
    expect(parseBuildFailure(log)).toEqual({
      file: '_posts/2026-07-17-break9.md',
      line: 2,
      problem: "Liquid syntax error (line 2): 'if' tag was never closed",
    });
  });

  it('handles a missing-include error (no line number)', () => {
    const log = `x ${ANSI}  Liquid Exception: Included file '_includes/nope.html' not found in /github/workspace/_posts/2026-07-17-p.md${RESET}`;
    expect(parseBuildFailure(log)).toEqual({
      file: '_posts/2026-07-17-p.md',
      problem: "Included file '_includes/nope.html' not found",
    });
  });

  it('strips the /github/workspace/ build-root prefix so paths are repo-relative', () => {
    const log = 'Liquid Exception: whatever in /github/workspace/index.md';
    expect(parseBuildFailure(log)?.file).toBe('index.md');
  });

  it('returns null when the log holds no recognizable Jekyll error', () => {
    expect(parseBuildFailure('just some build chatter, all fine')).toBeNull();
    expect(parseBuildFailure('')).toBeNull();
  });

  // A Liquid *Warning* is not a build failure — only Exceptions stop the build,
  // and blaming the user for a warning would be the false-positive #9 warns of.
  it('ignores Liquid warnings', () => {
    expect(parseBuildFailure('Liquid Warning: Excerpt modified in _posts/x.md')).toBeNull();
  });
});
