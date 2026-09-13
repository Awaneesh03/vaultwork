import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import type { Id, VaultEntityType, VaultLink } from '@/types/entities'
import { createRepository } from './baseRepository'

const base = createRepository('vaultLinks')

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((row) => row.deletedAt === null)

/**
 * The sync baseline: one row per entity that has met the vault.
 *
 * This store has existed unused since M1 with exactly the right shape —
 * `path`, `lastHashApp`, `lastHashFile`, `syncedAt` — so M10 needs no
 * migration. The two hashes are what make three-way conflict detection
 * possible: `lastHashApp` records what Vaultwork last serialized,
 * `lastHashFile` what the file said at that moment, and comparing today's
 * values against them is the only way to tell "they changed it" from "we
 * changed it".
 *
 * `&path` is unique, which is what stops two notes claiming the same file.
 */
export const vaultLinkRepo = {
  ...base,

  /** The baseline for one entity, if it has one. */
  async forEntity(entityType: VaultEntityType, entityId: Id): Promise<VaultLink | undefined> {
    try {
      const rows = await db.vaultLinks
        .where('[entityType+entityId]')
        .equals([entityType, entityId])
        .toArray()
      return live(rows)[0]
    } catch (error) {
      throw toRepositoryError('vaultLinks', error, 'forEntity')
    }
  },

  /** The baseline claiming a path, if any. Used to spot an orphaned file. */
  async byPath(path: string): Promise<VaultLink | undefined> {
    try {
      const row = await db.vaultLinks.where('path').equals(path).first()
      return row && row.deletedAt === null ? row : undefined
    } catch (error) {
      throw toRepositoryError('vaultLinks', error, 'byPath')
    }
  },

  /** Every live baseline — one read for a whole vault scan. */
  async listLive(): Promise<VaultLink[]> {
    try {
      return live(await db.vaultLinks.toArray())
    } catch (error) {
      throw toRepositoryError('vaultLinks', error, 'listLive')
    }
  },

  /**
   * Records a baseline, replacing whatever was there for this entity.
   *
   * Upsert rather than create-or-update at the call site, because a note can be
   * exported many times and each export supersedes the last. The path is part
   * of the row, so a rename replaces it rather than leaving a second claim.
   */
  async record(input: {
    entityType: VaultEntityType
    entityId: Id
    path: string
    lastHashApp: string
    lastHashFile: string
    syncedAt: number
  }): Promise<VaultLink> {
    const existing = await this.forEntity(input.entityType, input.entityId)

    // `emit: false` throughout: a baseline is internal sync bookkeeping, and a
    // `vaultLink.updated` beside every `note.exported` would be the same fact
    // recorded twice. The domain event is the accurate one.
    if (existing) {
      return base.update(
        existing.id,
        {
          path: input.path,
          lastHashApp: input.lastHashApp,
          lastHashFile: input.lastHashFile,
          syncedAt: input.syncedAt,
          direction: 'both',
        },
        { emit: false },
      )
    }

    return base.create(
      {
        entityType: input.entityType,
        entityId: input.entityId,
        path: input.path,
        lastHashApp: input.lastHashApp,
        lastHashFile: input.lastHashFile,
        syncedAt: input.syncedAt,
        direction: 'both',
      },
      { emit: false },
    )
  },

  /** Forgets a baseline entirely — used when a file is deleted from the vault. */
  async forget(entityType: VaultEntityType, entityId: Id): Promise<boolean> {
    const existing = await this.forEntity(entityType, entityId)
    if (!existing) return false
    // A hard delete: a baseline is a fact about the last sync, and "never
    // synced" is the absence of the row rather than a tombstone to filter out.
    await base.hardDelete(existing.id, { emit: false })
    return true
  },

  /** Drops every baseline. Used when a vault is disconnected. */
  async forgetAll(): Promise<number> {
    try {
      const rows = await db.vaultLinks.toArray()
      await db.vaultLinks.bulkDelete(rows.map((row) => row.id))
      return rows.length
    } catch (error) {
      throw toRepositoryError('vaultLinks', error, 'forgetAll')
    }
  },
}
