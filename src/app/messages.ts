// Every user-facing sentence in one place, written for the target user: a
// blogger whose site is likely their only repo, who cannot read a stack
// trace. Git/CI vocabulary stops at this file.
import type { FinishLineEvent } from '../finishline/index.js';
import type { LayoutBasis } from '../layout/index.js';

// Where the app looked for posts, when it could not be told (#17). Silence was
// the phase-1 bug: a /docs site showed an empty list and explained nothing.
// 'pages' is absent on purpose — GitHub stated the root, so nothing was assumed
// and there is nothing to confess.
export function describeAssumedRoot(basis: Exclude<LayoutBasis, 'pages'>): string {
  const tail =
    ' This page is showing posts from the top level of your repository — if yours live somewhere else, they will not appear here.';
  switch (basis) {
    case 'workflow':
      return (
        'Your site is built by a GitHub Actions workflow, so your repository settings do not say where its posts are kept.' +
        tail
      );
    case 'pages-unreadable':
      return (
        'Your repository is private, and this token is not allowed to read its GitHub Pages settings, so they cannot say where your posts are kept.' +
        tail
      );
    case 'no-pages':
      return (
        'GitHub Pages is not turned on for this repository yet, so there are no settings saying where your posts are kept.' +
        tail
      );
  }
}

export function describeEvent(e: FinishLineEvent): string {
  switch (e.kind) {
    case 'no-pages':
      return 'This repository does not have GitHub Pages turned on, so nothing can go live yet. In your repository settings, open “Pages” and choose a branch to publish from.';
    case 'pages-unreadable':
      return 'Your repository is private, and this token is not allowed to read its GitHub Pages settings — so whether your post went live cannot be confirmed here. Your changes are saved safely in the repository either way. To see publishing status, create the token again and also set “Pages” to “Read-only”.';
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
  // Row 4 of #17's ladder: neither _config.yml nor _posts/ at the resolved
  // root. Guessing on from here is how posts get written where Jekyll never
  // reads, so the app stops instead.
  // #18: GitHub returns a partial tree above ~100k files and says only that it
  // did so, not what it left out. Posts outside the usual folder cannot be
  // looked for, and pretending otherwise is the silent omission this all exists
  // to stop.
  // #18: GitHub returns a partial tree above ~100k files and says only that it
  // did so, not what it left out.
  // #12: pages have no canonical folder to fall back to the way posts do, so
  // there is no honest partial answer — none are listed at all, and the
  // sentence has to say that rather than let the section vanish quietly.
  treeTruncated:
    'This repository has too many files for the CMS to search all of it. Only posts in the usual folder are listed — if you keep posts in other folders, they will not appear here — and your pages cannot be listed at all.',
  // The stated half of #12's extension blind spot. A file needs a name ending
  // in .md (or the site's markdown_ext) or .html to be found; Jekyll's real
  // rule is front matter alone, so a front-matter'd LICENSE is a page the CMS
  // cannot see. #5 rejected slug-only titles because "the list would lie" — an
  // omission the user is never told about is the same lie, so it is said here.
  pagesBlindSpot:
    'Only files ending in .md or .html are listed as pages. If a page of your site has a different kind of name, you will not see it here — edit it on GitHub instead.',
  // Liquid is Jekyll's templating language. Nothing edits it here — the file's
  // bytes round-trip untouched — but `marked` renders `{% … %}` as literal
  // text, so an un-caveated preview lies about what the page will look like.
  liquidPreview:
    'This file uses Jekyll templating ({% … %}), which builds part of the page when your site is published. The preview cannot show it, so it will look wrong here — that is expected. Your text is saved exactly as written; leave the {% … %} parts alone unless you know what they do.',
  // Said once after an image is inserted (#14). Two things the owner cannot see
  // and would want to know: the `![]()` has no alt text (theirs to write — the
  // app will not invent a description of their photo), and re-saving the photo
  // for the web removed its embedded location data. The image commits with the
  // post on Save, so nothing lands if the post is abandoned.
  imageInserted:
    'Image added. Write a short description between the [ ] so screen readers can read it — it is left blank on purpose. Its embedded location data (where the photo was taken) was removed automatically. The image is saved when you Save the post.',
  imageTooLarge: (name: string) =>
    `“${name}” could not be read as an image. Only photo files (JPEG, PNG, and similar) can be added.`,
  noJekyllSite: (root: string) =>
    `No Jekyll site was found in ${
      root === '' ? 'the top level of this repository' : `the “${root}” folder of this repository`
    }, so there is nowhere safe to save posts. Check that your repository settings under “Pages” point at the folder your site is actually in.`,
};
