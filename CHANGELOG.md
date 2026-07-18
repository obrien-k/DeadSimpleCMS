# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Starting with 0.1.0, releases are cut by [release-please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org/) on `main`.

## [0.1.0] - 2026-07-18

Initial build-out of the CMS, tracked retrospectively from the project's commit history.

### Added
- Core admin loop: browse, edit, and publish Jekyll front matter round-tripped through YAML's CST API (#5, #6)
- Git Data API atomic commits, verified against a live scratch repo
- Source-root resolution — Jekyll's actual `_posts` lookup rules, not a fixed path (#17, #18)
- Page detection from front matter, with no fixed schema (#12)
- Form fields generated dynamically from each file's front-matter schema (#13)
- Image upload: resize, folder inference, GPS stripping (#14)
- Build-failure detection and translation — a red build names the post, not a timeout (#9)
- One-click revert/undo — unpublish reverses the move and keeps the images (#9)
- Draft polish — unpublish runs publish backwards; delete tombstones the draft (#16)
- Conflict recovery — a stale edit opens a compare view instead of a dead end (#15)
- Setup wizard / installer, hosted on the project's own GitHub Pages, with automatic Pages provisioning (#29)
- PAT expiry warning, with re-auth prompted before the 401 (#30)
- Installer E2E fixes: honest completion, a guard against non-Jekyll sites, Enter-to-submit, 365-day tokens

### Changed
- Project renamed to DeadSimpleCMS; MIT license added
- README refreshed to point at the live installer

### Removed
- Dropped the TOFU signing chain — CI-held keys made it theatre (#3)
- Ruled the Cloudflare Worker OAuth path out of scope (#31)
