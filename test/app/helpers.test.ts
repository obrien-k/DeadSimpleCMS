import { describe, expect, it } from 'vitest';
import { parseRepoConfig, ConfigError } from '../../src/app/config.js';
import { checkTokenFormat } from '../../src/app/token.js';
import { jekyllDate, publishPath, slugify, unpublishPath } from '../../src/app/dates.js';
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
  it('derives YYYY-MM-DD-slug.md from the front-matter date', () => {
    expect(publishPath('my-post', '2026-07-17 01:30:00 +0200', '_posts')).toBe(
      '_posts/2026-07-17-my-post.md',
    );
  });

  // #17: the directory is resolved, never assumed — a /docs site publishing to
  // `_posts/` writes where Jekyll never reads, and the post silently never goes live.
  it('publishes into the resolved posts directory, wherever it is', () => {
    expect(publishPath('my-post', '2026-07-17 01:30:00 +0200', 'docs/_posts')).toBe(
      'docs/_posts/2026-07-17-my-post.md',
    );
  });
});

// The inverse move behind Unpublish (#16): _posts/DATE-slug.md → _drafts/slug.md.
describe('unpublish path', () => {
  it('strips the filename date prefix and retargets the drafts directory', () => {
    expect(unpublishPath('_posts/2026-07-17-my-post.md', '_drafts')).toBe('_drafts/my-post.md');
  });

  // The front-matter date is the source of truth (#5); only the redundant
  // filename prefix is dropped, so republishing re-derives the same name. A slug
  // that itself begins with a year keeps that year — only the leading DATE- goes.
  it('drops only the leading date, not a year inside the slug', () => {
    expect(unpublishPath('_posts/2019-01-02-2020-review.md', '_drafts')).toBe('_drafts/2020-review.md');
  });

  // #17: drafts are written under the resolved write base, wherever that is.
  it('retargets into the resolved drafts directory, wherever it is', () => {
    expect(unpublishPath('docs/_posts/2026-07-17-my-post.md', 'docs/_drafts')).toBe(
      'docs/_drafts/my-post.md',
    );
  });

  // A hand-named post with no date prefix keeps its basename as the draft slug.
  it('leaves a non-dated post basename intact', () => {
    expect(unpublishPath('_posts/hand-named.md', '_drafts')).toBe('_drafts/hand-named.md');
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
