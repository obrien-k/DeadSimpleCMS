// Every user-facing sentence in one place, written for the target user: a
// blogger whose site is likely their only repo, who cannot read a stack
// trace. Git/CI vocabulary stops at this file.
import type { FinishLineEvent } from '../finishline/index.js';

export function describeEvent(e: FinishLineEvent): string {
  switch (e.kind) {
    case 'no-pages':
      return 'This repository does not have GitHub Pages turned on, so nothing can go live yet. In your repository settings, open “Pages” and choose a branch to publish from.';
    case 'publishing':
      return 'Publishing…';
    case 'building':
      return e.state === 'in_progress' ? 'Building your site…' : 'Waiting for the build to start…';
    case 'build-failed':
      return 'The site build failed, so this post is not live. Your previous posts are unaffected. Check the build details on GitHub, or undo this change and try again.';
    case 'live':
      return `Your post is live!`;
    case 'live-unverified':
      return 'The build finished and your post is listed, but the page did not answer yet — it may need another minute.';
    case 'skipped': {
      return e.reason === 'future-dated'
        ? 'The build succeeded, but the post is dated in the future, and the site is set up to hide future posts. It will appear when the site next rebuilds after that time — or change the date to now and save again.'
        : 'The build succeeded, but this post has “published: false” in its settings, which tells the site to hide it. Remove that line to make it visible.';
    }
    case 'baseurl-misconfigured':
      return `The site's sitemap points at ${e.sitemapUrl}, which is outside the site's real address (${e.siteRoot}). This usually means "baseurl" is unset in _config.yml. Links on the site will look fine, but shared links will be broken until it is fixed.`;
    case 'not-in-sitemap':
      return 'The build succeeded, but the post has not appeared in the site index. It may show up on the next rebuild; if not, its date or settings may be telling the site to skip it.';
    case 'built-no-sitemap':
      return `The build succeeded. This site has no sitemap, so the exact address could not be confirmed — your post should be reachable from the homepage at ${e.siteRoot}.`;
    case 'timeout':
      return 'GitHub has not reported anything for a while. The publish commit is safely in your repository; check back in a minute.';
  }
}

export const MSG = {
  insecure:
    'This admin page is not being served over HTTPS, so it is not safe to use — a token entered here could be stolen. In your repository settings, open “Pages” and turn on “Enforce HTTPS” (it may take a while to become available), then reload.',
  classicToken:
    'That looks like a classic token (it starts with “ghp_”). Classic tokens always have access to every repository in your account, which is far more than this site needs. Please create a fine-grained token instead — the link below sets one up.',
  emptyToken: 'Paste a token to continue.',
  probeFailed:
    'GitHub did not accept the token for this repository. This usually means one of: the token was scoped to a different repository, no repository was chosen in the “Repository access” dropdown, or “Contents” access was not set to “Read and write”. Create the token again with only this site’s repository selected.',
  conflict:
    'This post changed on GitHub since you opened it (maybe from another tab or device). Nothing was saved. Reload to get the latest version, then re-apply your edit.',
  dropdownCallout: (repo: string) =>
    `On the token page, under “Repository access”, choose ONLY ${repo}. That dropdown is the one thing keeping this token limited to your site.`,
  expiryWarning: (days: number) =>
    `Your GitHub token expires in ${days} day${days === 1 ? '' : 's'}. Create a new one soon, or publishing will stop working.`,
  staleEdit:
    'Saved. Heads up: the live page can keep showing the old text for up to 10 minutes after an edit.',
};
