import { DATABASE_NAME, db, openDatabase, STORE_NAMES, withEventLogUnlocked } from '@/db'
import { seedIfEmpty, type SeedResult } from '@/db/seed'
import { CURRENT_SCHEMA_VERSION } from '@/db/migrations'
import { hashObject } from '@/lib/hash'
import { toRepositoryError } from '@/lib/errors'
import type { BackupData, BackupFile } from '@/types/backup'
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from '@/types/backup'
import type { StoreName } from '@/types/entities'

/**
 * Whole-database operations. They live in the repository layer because they
 * need a single transaction across every table — something a service, which is
 * not allowed to know Dexie exists, cannot open.
 */
export const maintenanceRepo = {
  /** Opens the database, translating IndexedDB's refusals into plain English. */
  open(): Promise<void> {
    return openDatabase()
  },

  seedIfEmpty(now?: Date): Promise<SeedResult> {
    return seedIfEmpty(db, now)
  },

  /**
   * Where the data actually is. For the diagnostics panel, which needs to name
   * the database without a service learning that Dexie exists.
   */
  describe(): { name: string; schemaVersion: number } {
    return { name: DATABASE_NAME, schemaVersion: CURRENT_SCHEMA_VERSION }
  },

  async counts(): Promise<Record<StoreName, number>> {
    const entries = await Promise.all(
      STORE_NAMES.map(async (name) => [name, await db.table(name).count()] as const),
    )
    return Object.fromEntries(entries) as Record<StoreName, number>
  },

  /** Live (non-deleted) counts for the stores worth showing on screen. */
  async liveCounts(): Promise<Record<string, number>> {
    const named: StoreName[] = ['tasks', 'projects', 'goals', 'habits', 'notes', 'tags']
    const entries = await Promise.all(
      named.map(async (name) => {
        const rows = (await db.table(name).toArray()) as { deletedAt: number | null }[]
        return [name, rows.filter((r) => r.deletedAt === null).length] as const
      }),
    )
    return Object.fromEntries(entries)
  },

  async exportAll(appVersion: string): Promise<BackupFile> {
    try {
      const data = {} as BackupData
      await db.transaction(
        'r',
        STORE_NAMES.map((n) => db.table(n)),
        async () => {
          for (const name of STORE_NAMES) {
            // Cast is unavoidable: the union of fourteen row types cannot be
            // narrowed by a runtime string, and BackupData keys them correctly.
            ;(data as Record<string, unknown[]>)[name] = await db.table(name).toArray()
          }
        },
      )

      const counts = Object.fromEntries(
        STORE_NAMES.map((name) => [name, (data as Record<string, unknown[]>)[name]?.length ?? 0]),
      )

      return {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion,
        exportedAt: Date.now(),
        checksum: hashObject(data),
        counts,
        data,
      }
    } catch (error) {
      throw toRepositoryError('*', error, 'exportAll')
    }
  },

  /**
   * Replaces the entire database with the contents of a backup, in one
   * transaction: either every store is restored or nothing changed.
   */
  async replaceAll(data: BackupData): Promise<void> {
    try {
      await withEventLogUnlocked(db, async () => {
        await db.transaction(
          'rw',
          STORE_NAMES.map((n) => db.table(n)),
          async () => {
            for (const name of STORE_NAMES) {
              await db.table(name).clear()
              const rows = (data as Record<string, unknown[]>)[name] ?? []
              if (rows.length > 0) await db.table(name).bulkAdd(rows)
            }
          },
        )
      })
    } catch (error) {
      throw toRepositoryError('*', error, 'replaceAll')
    }
  },

  async clearAll(): Promise<void> {
    try {
      await withEventLogUnlocked(db, async () => {
        await db.transaction(
          'rw',
          STORE_NAMES.map((n) => db.table(n)),
          async () => {
            for (const name of STORE_NAMES) await db.table(name).clear()
          },
        )
      })
    } catch (error) {
      throw toRepositoryError('*', error, 'clearAll')
    }
  },

  /** Permanently removes rows soft-deleted before a cutoff. */
  async purgeDeletedBefore(cutoff: number): Promise<number> {
    const purgeable = STORE_NAMES.filter((n) => n !== 'events' && n !== 'settings')
    let removed = 0
    try {
      await db.transaction(
        'rw',
        purgeable.map((n) => db.table(n)),
        async () => {
          for (const name of purgeable) {
            const rows = (await db.table(name).where('deletedAt').below(cutoff).toArray()) as {
              id: string
            }[]
            if (rows.length === 0) continue
            await db.table(name).bulkDelete(rows.map((r) => r.id))
            removed += rows.length
          }
        },
      )
      return removed
    } catch (error) {
      throw toRepositoryError('*', error, 'purgeDeletedBefore')
    }
  },
}
