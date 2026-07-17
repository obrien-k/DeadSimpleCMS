import { describe, expect, it } from 'vitest';
import { parseRepoConfig, ConfigError } from '../../src/app/config.js';
import { checkTokenFormat } from '../../src/app/token.js';
import { jekyllDate, publishPath, slugify } from '../../src/app/dates.js';
import { parseRoute } from '../../src/app/router.js';

describe('repo config anchor', () => {
  it('accepts owner/name', () => {
    expect(parseRepoConfig('kyle/site')).toBe('kyle/site');
  });

  it('a malformed config line is a hard error, never overridden client-side', () => {
    for (const bad of ['kyle', 'kyle/site/extra', 'https://github.com/kyle/site', ' ', 'a b/c']) {
      expect(() => parseRepoConfig(bad), bad).toThrow(ConfigError);
    }
  });

  it('absent config (null) means first-run prompt, not an error', () => {
    expect(parseRepoConfig(null)).toBeNull();
  });
});

describe('token first-use checks (the decidable subset)', () => {
  it('refuses a classic token by prefix — all-repositories by construction', () => {
    expect(checkTokenFormat('ghp_abc123')).toMatchObject({ ok: false, reason: 'classic' });
  });

  it('accepts a fine-grained token', () => {
    expect(checkTokenFormat('github_pat_11ABC')).toEqual({ ok: true });
  });

  it('rejects empty input', () => {
    expect(checkTokenFormat('  ')).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('jekyllDate: local time, never toISOString', () => {
  const instant = new Date('2026-07-16T23:30:00Z');

  it('formats in the given zone with its offset', () => {
    // UTC+2 (getTimezoneOffset convention: -120)
    expect(jekyllDate(instant, -120)).toBe('2026-07-17 01:30:00 +0200');
  });

  it('the trap case: local date differs from the UTC date', () => {
    // UTC-7, 23:30Z is still 16:30 the SAME day locally; toISOString would
    // have future-dated a post written at 11pm in a UTC+ zone.
    expect(jekyllDate(instant, 420)).toBe('2026-07-16 16:30:00 -0700');
  });
});

describe('publish path', () => {
  it('derives _posts/YYYY-MM-DD-slug.md from the front-matter date', () => {
    expect(publishPath('my-post', '2026-07-17 01:30:00 +0200')).toBe(
      '_posts/2026-07-17-my-post.md',
    );
  });
});

describe('slugify', () => {
  it('lowercases and dashes a title', () => {
    expect(slugify('My Post: A Deeper Look!')).toBe('my-post-a-deeper-look');
  });
});

describe('router', () => {
  it('parses the three views', () => {
    expect(parseRoute('')).toEqual({ view: 'list' });
    expect(parseRoute('#/')).toEqual({ view: 'list' });
    expect(parseRoute('#/new')).toEqual({ view: 'new' });
    expect(parseRoute('#/edit/_posts/2026-07-01-a%20b.md')).toEqual({
      view: 'edit',
      path: '_posts/2026-07-01-a b.md',
    });
  });

  it('unknown routes fall back to the list', () => {
    expect(parseRoute('#/wat/ever')).toEqual({ view: 'list' });
  });
});
