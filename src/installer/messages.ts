// Installer-surface copy. Kept out of src/app/messages.ts so it never ships in
// the budget-constrained vendored bundle — but the shared sentences (insecure,
// no-Pages, probe-failed, classic-token, dropdown callout, expiry) are imported
// from there so the two surfaces speak with one voice and drift can't set in.
import { MSG } from '../app/messages.js';
import type { CollisionKind } from './collision.js';

export const IMSG = {
  shared: MSG,

  landingBody:
    'A tiny CMS for your Jekyll site on GitHub Pages. No server to run, no config file to write. This page installs an editor into your site’s repository; after that you write posts from a browser and they go live at your own URL.',
  landingNeeds: 'You’ll need: a GitHub repo with a Jekyll site, and two minutes.',

  repoLabel: 'Your site repository (owner/name)',
  repoWhyTyped:
    'Typed, not picked from a list: a fine-grained token can’t list the repositories it’s allowed into, so there’s no honest dropdown to show.',
  repoMalformed: 'Repository must look like owner/name.',

  // The preflight blocks reuse the app's exact sentences where one exists; the
  // no-Pages case is installer-specific ("turn it on before installing" rather
  // than the app's post-publish "nothing can go live yet"), so it's authored
  // here rather than forced onto the app's sentence.
  unreachable: MSG.probeFailed,
  noPages:
    'This repository doesn’t have GitHub Pages turned on yet, so there’s nowhere for your site — or this editor — to go live. In your repository settings, open “Pages” and choose a branch to publish from, then re-check.',
  insecure: MSG.insecure,
  insecureIsDefault:
    'This is the state a fresh custom domain lands in by default while its certificate provisions — not an exotic misconfiguration.',
  // Refused before any commit when the source root has no _config.yml. The
  // editor edits Jekyll sites; a site built another way publishes its build
  // output, not the committed admin/, so installing would guarantee a 404.
  notJekyll:
    'This repository doesn’t look like a Jekyll site — there’s no _config.yml at the folder GitHub Pages builds from. DeadSimpleCMS edits Jekyll sites (posts in _posts, settings in _config.yml); a site built another way, for example with Astro or Next.js, publishes its built output rather than these files, so the editor wouldn’t appear. If this is a Jekyll site kept in a different folder, point GitHub Pages at that folder and re-check.',

  // #8 collision screens.
  collisionHeading(kind: CollisionKind): string {
    switch (kind) {
      case 'clean':
        return 'admin/ is clear';
      case 'ours':
        return 'admin/ is a DeadSimpleCMS install — this will repair it';
      case 'ours-moved':
        return 'admin/ is a DeadSimpleCMS install for another repository';
      case 'decap':
        return 'admin/ looks like a Decap CMS install';
      case 'unknown-safe':
        return 'admin/ exists but has no files we would overwrite';
      case 'unknown-index':
        return 'admin/index.html already exists and isn’t ours';
    }
  },

  ours:
    'This repository already has DeadSimpleCMS installed. Continuing refreshes admin/index.html and admin/bundle.js to the current version — nothing else is touched.',
  oursMoved: (repo: string) =>
    `The installed admin page points at a different repository. Continuing repoints it at ${repo} and refreshes it. If this repository was copied from another, that’s expected.`,
  decap:
    'This repository has what looks like a Decap CMS install. Installing will replace admin/index.html (Decap’s entry page) and add admin/bundle.js. It will leave admin/config.yml and everything else alone — nothing of yours is deleted, and the old file stays in your repository’s history.',
  decapFromDecap:
    'Coming from Decap? Your posts don’t move, and their fields are read from each post’s front matter rather than a config file, so there’s no collection config to port.',
  unknownSafe:
    'There’s already an admin/ folder, but nothing named index.html or bundle.js — so your files stay put and we install alongside them.',
  unknownIndex:
    'There’s already a file at admin/index.html that DeadSimpleCMS didn’t create, and we can’t tell what it is — so we won’t overwrite it and risk destroying something you need. Move or remove admin/index.html, then run the installer again.',

  // 'workflow' Pages builds don't serve files by source path (#17), so admin/
  // may not appear at the URL. Warned, not blocked — we can't know their build.
  workflowWarning:
    'Heads up: this site is built by a GitHub Actions workflow, so where admin/ ends up live depends on that workflow. If the editor doesn’t appear after installing, your workflow may need to include the admin/ folder in what it publishes.',
  truncatedWarning:
    'This repository is very large, so we couldn’t read all of it — if an admin/ page already exists deep in the tree, we may not have seen it.',

  // Status line under the step indicator while the deployment is watched.
  buildingStatus: 'GitHub is building the site — this usually takes a minute or two.',
  liveAt: (url: string) => `Your CMS is live at ${url}`,
  // Honest end states (the old poll declared "live" on a timeout, sending the
  // user to a 404). 'building' = committed, but no successful deployment was
  // seen within the wait — never a false "live".
  stillBuilding:
    'Your editor is committed, but GitHub hasn’t reported the site as live yet. It can take a minute or two — open the link below, and if you get a 404, wait a moment and reload. If it keeps 404ing, your site may not be publishing: check the repository’s “Actions” tab and Settings → Pages.',
  buildFailed:
    'Your editor is committed, but the site build failed, so nothing new is live yet. Your existing posts are unaffected. Check the build under the repository’s “Actions” tab, fix what it reports, and the editor will appear once the site builds green.',
  repairedNote:
    'This was a repair — your existing install was refreshed to the current version. Your content wasn’t touched.',
} as const;
