# DeadSimpleCMS

A minimal, zero-server CMS for Jekyll sites on GitHub Pages. See
[docs/DESIGN.md](docs/DESIGN.md) for the design and its decision log.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`obrien-k/DeadSimpleCMS`), via the `gh` CLI.
External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical vocabulary, unmodified: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root, both created lazily
by `/domain-modeling`. See `docs/agents/domain.md`.
