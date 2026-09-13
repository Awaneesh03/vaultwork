import { hashContent } from './content'

/**
 * Three-way conflict detection.
 *
 * Pure, synchronous, and given everything it needs as arguments — which is what
 * lets the six cases in the milestone be asserted directly rather than by
 * driving a filesystem.
 *
 * The model is the one every version control system uses:
 *
 *                 BASE — what both sides last agreed on
 *                  ├── Vaultwork now
 *                  └── vault file now
 *
 * Without BASE it is impossible to tell "they changed it" from "we changed it":
 * both look like *different*, and a two-way comparison has to guess. Guessing
 * is how an editor silently eats an afternoon's writing. BASE is the recorded
 * hash from the last successful export or import, and it is the entire reason
 * this module can answer the question honestly.
 *
 * Nothing here merges. A merge is a decision about intent, and the milestone is
 * explicit that the user makes it.
 */

export type SyncStatus =
  /** Both sides match the baseline. Nothing to do. */
  | 'clean'
  /** Vaultwork has moved on; the file has not. Safe to export. */
  | 'local-change'
  /** The file has moved on; Vaultwork has not. Safe to import. */
  | 'external-change'
  /** Both moved, and not to the same place. The user must choose. */
  | 'conflict'
  /** The note has never been exported. */
  | 'not-exported'
  /** Exported once, but the file is no longer there. */
  | 'missing'
  /** A file with no note behind it. Importable. */
  | 'untracked'
  /**
   * The file carries a known note id but sits at a different path than the
   * baseline recorded. Its content still matches.
   */
  | 'moved'
  /** Moved *and* edited. Two decisions in one, so it gets its own state. */
  | 'moved-change'
  /** Two files claim the same note id. Identity is ambiguous. */
  | 'duplicate-id'
  /** Two notes want the same vault path. */
  | 'path-collision'
  /** The note was deleted in Vaultwork but its file is still in the vault. */
  | 'deleted-local'
  /** Skipped by the ignore rules — a dot-folder, or not Markdown. */
  | 'ignored'
  /** Could not be read or parsed. Reported, never guessed at. */
  | 'error'

export interface ConflictInput {
  /**
   * Canonical serialization of the note as it stands now, or `null` when the
   * note no longer exists in Vaultwork.
   */
  local: string | null
  /** Current file contents, or `null` when the file is absent. */
  remote: string | null
  /**
   * Hash recorded at the last successful sync — the shared ancestor.
   * `null` means the two sides have never been reconciled.
   */
  baseHash: string | null
}

export interface ConflictResult {
  status: SyncStatus
  /** Hash of `local`, so a caller can record it without hashing again. */
  localHash: string | null
  remoteHash: string | null
  /** True when a write would destroy something the user has not seen. */
  needsUserChoice: boolean
}

/**
 * Which of the seven states a note and its file are in.
 *
 * The order of the checks matters: absence is decided before content, because
 * "the file is gone" is a different problem from "the file changed", and
 * reporting the second when the first is true sends the user looking for an
 * edit nobody made.
 */
export function detectStatus(input: ConflictInput): ConflictResult {
  return detectStatusFromHashes({
    localHash: input.local === null ? null : hashContent(input.local),
    remoteHash: input.remote === null ? null : hashContent(input.remote),
    baseHash: input.baseHash,
  })
}

export interface HashComparison {
  localHash: string | null
  remoteHash: string | null
  baseHash: string | null
}

/**
 * The same case analysis, for callers that already hold hashes.
 *
 * A whole-vault scan hashes each side once and then compares thousands of
 * pairs; re-hashing at every comparison would be wasteful, and — worse —
 * hashing an already-hashed value would compare a double hash against the
 * single hash in the baseline and report everything as changed. One
 * implementation, two entry points.
 */
export function detectStatusFromHashes(input: HashComparison): ConflictResult {
  const { localHash, remoteHash } = input

  const result = (status: SyncStatus): ConflictResult => ({
    status,
    localHash,
    remoteHash,
    needsUserChoice: status === 'conflict',
  })

  // A file with no note behind it — something the user wrote in Obsidian.
  if (localHash === null) {
    return result(remoteHash === null ? 'missing' : 'untracked')
  }

  // Never exported: there is no baseline and no file.
  if (remoteHash === null) {
    return result(input.baseHash === null ? 'not-exported' : 'missing')
  }

  // A file exists but Vaultwork has no record of putting it there. Treating
  // this as "clean" would let an export silently overwrite a file the user
  // wrote by hand, so identical content is the only safe way through.
  if (input.baseHash === null) {
    return result(localHash === remoteHash ? 'clean' : 'conflict')
  }

  const localChanged = localHash !== input.baseHash
  const remoteChanged = remoteHash !== input.baseHash

  if (!localChanged && !remoteChanged) return result('clean')
  if (localChanged && !remoteChanged) return result('local-change')
  if (!localChanged && remoteChanged) return result('external-change')

  // Both moved. If they happen to have arrived at the same text there is
  // nothing to reconcile — that is convergence, not a conflict.
  return result(localHash === remoteHash ? 'clean' : 'conflict')
}

/** True when an export may proceed without asking the user first. */
export function canExportSafely(status: SyncStatus): boolean {
  return status === 'clean' || status === 'local-change' || status === 'not-exported'
}

/** True when an import may proceed without asking the user first. */
export function canImportSafely(status: SyncStatus): boolean {
  return status === 'clean' || status === 'external-change' || status === 'untracked'
}
