import { describe, expect, it } from 'vitest';
import { MSG } from '../../src/app/messages.js';
import { tokenListUrl, tokenTemplateUrl } from '../../src/app/token.js';

describe('post-expiry copy (#30)', () => {
  it('names the date when the token reported one', () => {
    const m = MSG.tokenExpired('July 12, 2026');
    expect(m).toContain('expired on July 12, 2026');
    expect(m).toContain('paste it below');
  });

  it('degrades to a revoked/deselected message when there is no date', () => {
    const m = MSG.tokenExpired(null);
    expect(m).not.toContain('expired on');
    expect(m).toMatch(/no longer valid/);
  });

  it('offers both renewal paths in either case', () => {
    for (const m of [MSG.tokenExpired('July 12, 2026'), MSG.tokenExpired(null)]) {
      expect(m).toMatch(/[Rr]egenerate/);
      expect(m).toMatch(/create a fresh/i);
    }
  });
});

describe('renewal links (#30)', () => {
  // Regenerate lands on the list (no id to deep-link); create-new keeps the
  // pre-filled form. The two are distinct URLs so the UI can offer both.
  it('regenerate points at the fine-grained token list', () => {
    expect(tokenListUrl()).toBe('https://github.com/settings/personal-access-tokens');
  });

  it('create-new is the pre-filled template, not the bare list', () => {
    expect(tokenTemplateUrl('owner')).toContain('/personal-access-tokens/new?');
    expect(tokenTemplateUrl('owner')).not.toBe(tokenListUrl());
  });
});
