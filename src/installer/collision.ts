// #8: what the installer does when admin/ already exists. The classification is
// the whole safety story — it decides whether the two files the installer
// writes (admin/index.html, admin/bundle.js) replace something, and under what
// consent. Precedence is ours → decap → unknown, so a repo carrying both our
// marker and a stray config.yml reads as ours and repair is never blocked.

export type CollisionKind =
  | 'clean' // no admin/ at all
  | 'ours' // our admin/index.html, meta names this repo — repair
  | 'ours-moved' // our admin/index.html, meta names another repo — repair & repoint
  | 'decap' // admin/config.yml present, index.html not ours — named consented replace
  | 'unknown-safe' // admin/ exists but nothing we would overwrite — install alongside
  | 'unknown-index'; // admin/index.html exists and is not ours — refuse

export interface CollisionInputs {
  /** Repo paths under admin/, from the pre-write tree read. */
  adminEntries: string[];
  /**
   * The dscms:repo value read from an existing admin/index.html, or null when
   * that file is absent or carries no such meta. Extraction happens at the
   * browser call site (DOMParser + readRepoConfig); this stays pure so the
   * table below is unit-testable in the node test env.
   */
  indexRepoMeta: string | null;
  /** "owner/name" being installed into. */
  targetRepo: string;
}

export interface Collision {
  kind: CollisionKind;
  /** Whether install may proceed without an explicit extra confirmation. */
  blocks: boolean;
  /** Whether an install would overwrite a file we did not author. */
  destructive: boolean;
}

const has = (entries: string[], path: string) => entries.includes(path);

export function classifyCollision({
  adminEntries,
  indexRepoMeta,
  targetRepo,
}: CollisionInputs): Collision {
  // Ours first: a non-null meta can only have come from an existing
  // admin/index.html, so this both detects our install and outranks a leftover
  // config.yml. Repair (and repair-with-repoint) must never be gated.
  if (indexRepoMeta !== null) {
    const kind = indexRepoMeta === targetRepo ? 'ours' : 'ours-moved';
    return { kind, blocks: false, destructive: false };
  }

  // Decap marker. index.html here is not ours (meta was null), so replacing it
  // is a real overwrite — consented, never silent.
  if (has(adminEntries, 'admin/config.yml')) {
    return { kind: 'decap', blocks: false, destructive: true };
  }

  // A non-ours, non-Decap admin/index.html: we cannot name what would be lost,
  // so consent cannot be informed. Refuse rather than guess.
  if (has(adminEntries, 'admin/index.html')) {
    return { kind: 'unknown-index', blocks: true, destructive: true };
  }

  // admin/ holds files, but none we would overwrite — install alongside them.
  if (adminEntries.some((p) => p.startsWith('admin/'))) {
    return { kind: 'unknown-safe', blocks: false, destructive: false };
  }

  return { kind: 'clean', blocks: false, destructive: false };
}
