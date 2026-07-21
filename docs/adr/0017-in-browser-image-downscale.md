# ADR-0017: Downscale images in-browser, infer the folder, ride the post's commit

- **Status:** Accepted
- **Date:** July 2026
- **Issues:** #14
- **Code:** `src/image/`
- **Related:** ADR-0001 (multi-file commits), ADR-0013 (the `baseurl` trap)

## Context

Image insert is a phase-2 core-comfort feature. The hazard is a one-way door: **a 4 MB phone photo committed raw sits in git history forever.** Nothing the CMS does later removes it.

## Decision

Downscale in-browser to **1600px / JPEG**, upload to the site's **inferred** image folder, insert **root-relative** markdown, and let the image ride the post's own Save commit.

## Evidence

- The **native** downscale path (`createImageBitmap` + `OffscreenCanvas`) is **275 B gzip**. There is no encoder to ship and no budget reason to keep the original.
- Measured: **5.92 MB → ~240 kB (24×)**.
- Orientation is baked into the pixels.
- **All EXIF including GPS is stripped** as a side effect of re-encoding, so the owner's home address never reaches a public repo.
- Live-verified: post + binary image in one commit, bytes round-trip exact.

## Rationale for the sub-decisions

**Inferred folder, never a config prompt.** Inferred from the site's existing images; `assets/img` at N=0. Consistent with zero-config (ADR-0012's inference is the same move applied to fields).

**Root-relative markdown with no `{{ site.baseurl }}`.** Baking Liquid into the body has two costs: the preview misrenders it (ADR-0008 — `marked` renders Liquid as literal text), and it moves ADR-0013's sitemap `baseurl` 404 bug into posts.

**Alt text is left honestly blank.** Inventing a description of someone's photo is a lie.

**The image rides the post's Save commit** (ADR-0001's multi-file commit), so an abandoned post leaves no orphan blob, and one commit means one build.

## Consequences

- The original resolution is unrecoverable. Accepted deliberately: the alternative is permanent history bloat, and 1600px covers blog display.
- Re-encoding to JPEG is lossy and applies to PNGs too, including screenshots where it is a poorer fit than for photos. Not revisited yet.
- ADR-0015's Undo deliberately keeps co-committed image blobs, since the restored draft still links them.
