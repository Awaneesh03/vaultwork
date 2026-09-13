import { describe, expect, it } from 'vitest'
import { hashContent } from './content'
import { canExportSafely, canImportSafely, detectStatus, type SyncStatus } from './conflict'

/**
 * The three-way conflict model.
 *
 * These are the six cases the milestone enumerates, plus the ones that decide
 * whether a write is allowed to happen. Every assertion here stands between the
 * user and losing an afternoon's writing, so they are spelled out one at a time
 * rather than folded into a table.
 */

const A = 'content A\n'
const B = 'content B\n'
const C = 'content C\n'

const status = (local: string | null, remote: string | null, base: string | null): SyncStatus =>
  detectStatus({ local, remote, baseHash: base }).status

describe('the six cases', () => {
  it('case 1 — base A, local A, remote A: clean', () => {
    expect(status(A, A, hashContent(A))).toBe('clean')
  })

  it('case 2 — base A, local A, remote B: external change', () => {
    expect(status(A, B, hashContent(A))).toBe('external-change')
  })

  it('case 3 — base A, local B, remote A: local change', () => {
    expect(status(B, A, hashContent(A))).toBe('local-change')
  })

  it('case 4 — base A, local B, remote C: conflict', () => {
    expect(status(B, C, hashContent(A))).toBe('conflict')
  })

  it('case 5 — base A, both moved to B: clean, because they agree', () => {
    // Convergence is not a conflict: there is nothing left to reconcile.
    expect(status(B, B, hashContent(A))).toBe('clean')
  })

  it('case 6 — the file is gone: missing', () => {
    expect(status(A, null, hashContent(A))).toBe('missing')
  })
})

describe('states with no baseline', () => {
  it('reports a note that has never been exported', () => {
    expect(status(A, null, null)).toBe('not-exported')
  })

  it('reports a vault file with no note behind it', () => {
    expect(status(null, A, null)).toBe('untracked')
  })

  it('refuses to call an unknown pre-existing file clean', () => {
    // A file exists where Vaultwork wants to write, and Vaultwork never put it
    // there. Calling that clean would let the export silently destroy it.
    expect(status(A, B, null)).toBe('conflict')
  })

  it('accepts an unknown file whose content already matches', () => {
    expect(status(A, A, null)).toBe('clean')
  })

  it('reports nothing on either side as missing', () => {
    expect(status(null, null, null)).toBe('missing')
  })
})

describe('normalisation does not create conflicts', () => {
  it('ignores line endings', () => {
    // A file merely re-saved by a Windows editor must not read as changed.
    expect(status('a\nb\n', 'a\r\nb\r\n', hashContent('a\nb\n'))).toBe('clean')
  })

  it('ignores a missing or doubled trailing newline', () => {
    expect(status('a\n', 'a', hashContent('a\n'))).toBe('clean')
    expect(status('a\n', 'a\n\n\n', hashContent('a\n'))).toBe('clean')
  })

  it('still notices a real edit', () => {
    expect(status('a\n', 'a\nb\n', hashContent('a\n'))).toBe('external-change')
  })
})

describe('what the result carries', () => {
  it('hands back both hashes so the caller need not recompute them', () => {
    const result = detectStatus({ local: A, remote: B, baseHash: hashContent(A) })
    expect(result.localHash).toBe(hashContent(A))
    expect(result.remoteHash).toBe(hashContent(B))
  })

  it('leaves a hash null when that side is absent', () => {
    const result = detectStatus({ local: A, remote: null, baseHash: null })
    expect(result.remoteHash).toBeNull()
    expect(result.localHash).not.toBeNull()
  })

  it('flags exactly the conflict case as needing a decision', () => {
    expect(detectStatus({ local: B, remote: C, baseHash: hashContent(A) }).needsUserChoice).toBe(
      true,
    )
    expect(detectStatus({ local: A, remote: A, baseHash: hashContent(A) }).needsUserChoice).toBe(
      false,
    )
  })
})

describe('what may proceed without asking', () => {
  it('allows an export only when nothing external would be lost', () => {
    expect(canExportSafely('clean')).toBe(true)
    expect(canExportSafely('local-change')).toBe(true)
    expect(canExportSafely('not-exported')).toBe(true)

    // The three that would destroy something the user has not seen.
    expect(canExportSafely('conflict')).toBe(false)
    expect(canExportSafely('external-change')).toBe(false)
    expect(canExportSafely('untracked')).toBe(false)
  })

  it('allows an import only when nothing local would be lost', () => {
    expect(canImportSafely('clean')).toBe(true)
    expect(canImportSafely('external-change')).toBe(true)
    expect(canImportSafely('untracked')).toBe(true)

    expect(canImportSafely('conflict')).toBe(false)
    expect(canImportSafely('local-change')).toBe(false)
    expect(canImportSafely('missing')).toBe(false)
  })
})

