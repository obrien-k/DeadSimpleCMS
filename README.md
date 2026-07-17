# DeadSimpleCMS

A minimal, zero-server CMS for Jekyll sites on GitHub Pages, obsessed with one thing: getting a post from draft to *verified live on the web* without the writer ever touching git. One static `/admin/` page, a fine-grained GitHub token, and the GitHub REST API — no OAuth server, no config file, no hosted service.

**Status: phase 1 implemented** (the core loop: token auth → list posts → edit/create → commit → deploy status → verified live link). See [docs/DESIGN.md](docs/DESIGN.md) for the full design and decision log, including why this is a standalone build rather than a Decap CMS fork or plugin.

## Development

```
pnpm install
pnpm test               # unit tests + the Psych oracle (skips oracle if ruby is absent)
pnpm build              # emits dist/bundle.js (loaded by admin/index.html)
pnpm budget             # gzip size vs the ~100 kB hard limit
pnpm lint:yaml-wrapper  # forbids `yaml` imports outside src/frontmatter/
```

`src/frontmatter/` is the only module allowed to import the `yaml` library —
the Jekyll (Psych/YAML 1.1) typing fixes are per-call-site discipline, so the
number of call sites is kept at one. `test/oracle/psych-oracle.rb` is the
oracle for what Jekyll actually reads; the JS library is not.
