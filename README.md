# DeadSimpleCMS

A minimal, zero-server CMS for Jekyll sites on GitHub Pages, obsessed with one thing: getting a post from draft to *verified live on the web* without the writer ever touching git. One static `/admin/` page, a fine-grained GitHub token, and the GitHub REST API — no OAuth server, no config file, no hosted service.

**Status:** the core loop (token auth → list posts → edit/create → commit → deploy status → verified live link) and content editing (drafts, images, unpublish, conflict recovery) are implemented; a guided installer is live. See [docs/DESIGN.md](docs/DESIGN.md) for the full design and decision log, including why this is a standalone build rather than a Decap CMS fork or plugin.

## Install it on your site

The installer is a hosted page that writes `/admin/` into your repository for you — nothing to clone, nothing to build on your end:

### → https://kyleobrien.me/DeadSimpleCMS/

It points at your `owner/repo`, guides you through creating a fine-grained token (the page pre-fills everything except the one repository dropdown you have to set yourself), commits `admin/index.html` and `admin/bundle.js` as a single revertible commit, then watches the build until the page is live. From then on you edit at `https://<your-site>/admin/`.

Requirements: a Jekyll site already published on GitHub Pages, served over HTTPS — both the installer and the admin page refuse plain HTTP, because a token is entered there.

## Development

```
pnpm install
pnpm test               # unit tests + the Psych oracle (skips oracle if ruby is absent)
pnpm build              # emits dist/bundle.js (the IIFE loaded by admin/index.html)
pnpm build:installer    # emits the installer site (installer/ → dist-site/)
pnpm budget             # gzip size vs the ~100 kB hard limit
pnpm lint:yaml-wrapper  # forbids `yaml` imports outside src/frontmatter/
```

Two build outputs from one repo: `dist/bundle.js` is the admin app vendored into
users' sites, and `dist-site/` is the installer, deployed to this repo's own
GitHub Pages via Actions (`.github/workflows/pages.yml`) — not deploy-from-branch,
which would run Jekyll over the built output.

`src/frontmatter/` is the only module allowed to import the `yaml` library —
the Jekyll (Psych/YAML 1.1) typing fixes are per-call-site discipline, so the
number of call sites is kept at one. `test/oracle/psych-oracle.rb` is the
oracle for what Jekyll actually reads; the JS library is not.
