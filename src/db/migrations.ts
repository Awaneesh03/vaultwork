import type { Transaction } from 'dexie'
import type Dexie from 'dexie'

/**
 * One entry per schema version. Adding a version is always additive: append a
 * new object, never edit an existing one, or an installed database can no
 * longer replay its way forward.
 *
 * `stores` is the Dexie index declaration; `upgrade` runs once when a database
 * at an older version is opened.
 */
export interface MigrationDefinition {
  version: number
  stores: Record<string, string>
  /** Runs once, when a database at an older version is opened. */
  upgrade?: (tx: Transaction) => Promise<void>
}

/**
 * Version 1.
 *
 * Notes on the index choices:
 *  - Booleans are NOT valid IndexedDB keys, so `done` / `isTemplate` are never
 *    indexed. Indexing them would fail silently and leave rows out of results.
 *  - `[status+dueDate]` is what makes Today and Overdue index hits rather than
 *    table scans.
 *  - `&[habitId+date]` makes double-logging a habit structurally impossible.
 *  - `&[source+externalId]` is the idempotency guarantee the future Telegram
 *    channel needs: a redelivered update is rejected by the database.
 *  - `deletedAt` is nullable, so live rows are absent from that index by
 *    design; the index exists to make the purge job cheap.
 */
export const MIGRATIONS: MigrationDefinition[] = [
  {
    version: 1,
    stores: {
      tasks:
        'id, status, dueDate, projectId, milestoneId, seriesId, sortOrder, *tagIds, [status+dueDate], [projectId+status], completedAt, deletedAt',
      subtasks: 'id, taskId, sortOrder, deletedAt',
      projects: 'id, status, deadline, goalId, sortOrder, *tagIds, deletedAt',
      goals: 'id, status, targetDate, sortOrder, deletedAt',
      milestones: 'id, goalId, sortOrder, deletedAt',
      habits: 'id, sortOrder, archivedAt, deletedAt',
      habitEntries: 'id, &[habitId+date], habitId, date, deletedAt',
      focusSessions: 'id, startedAt, taskId, projectId, outcome, deletedAt',
      notes: 'id, [refType+refId], refId, updatedAt, *tagIds, deletedAt',
      tags: 'id, &name, deletedAt',
      events: 'id, at, type, [type+at], entityId, source',
      vaultLinks: 'id, &path, [entityType+entityId], syncedAt, deletedAt',
      messageLog: 'id, &[source+externalId], receivedAt, status, deletedAt',
      settings: 'id',
    },
  },

  /**
   * Version 2 — M9 notes.
   *
   * A note could previously point at exactly one entity, through `refType` and
   * `refId` on the row itself. M9 needs a note to reference several things at
   * once, so that relationship is normalised into `noteLinks`.
   *
   * The alternative — adding `linkedTaskIds`, `linkedProjectIds` and so on
   * beside the existing pair — would leave two different ways to say "this note
   * is about task X", and every future entity type would cost another column
   * and another index. One join table keeps a single source of truth and makes
   * a fifth link kind a no-op.
   *
   * The upgrade converts the old pair into rows and then deletes the fields, so
   * no note loses its link and nothing is left behind to disagree with the new
   * table. `notes` is reindexed on `vaultPath` and `title` because M9 looks a
   * note up by both; `[refType+refId]` goes away with the fields it indexed.
   */
  {
    version: 2,
    stores: {
      notes: 'id, title, vaultPath, updatedAt, *tagIds, deletedAt',
      noteLinks: 'id, noteId, [refType+refId], refId, deletedAt',
    },
    upgrade: async (tx) => {
      const legacy = tx.table<{
        id: string
        refType?: string
        refId?: string | null
        createdAt?: number
        updatedAt?: number
      }>('notes')

      const links: Record<string, unknown>[] = []

      await legacy.toCollection().modify((note) => {
        const { refType, refId } = note
        if (refType != null && refType !== 'none' && refId != null) {
          links.push({
            // Derived from the note id rather than random, so replaying the
            // upgrade on a copy of the same database produces the same rows.
            id: `${note.id}:${refType}:${refId}`,
            noteId: note.id,
            refType,
            refId,
            createdAt: note.createdAt ?? 0,
            updatedAt: note.updatedAt ?? 0,
            deletedAt: null,
          })
        }
        // The pair is now represented by a noteLinks row; leaving it here would
        // be a second, silently diverging copy of the relationship.
        delete note.refType
        delete note.refId
      })

      if (links.length > 0) await tx.table('noteLinks').bulkAdd(links)
    },
  },

  /**
   * Version 3 — PDF documents from the vault.
   *
   * Purely additive: one new store, no change to any existing one, and no
   * `upgrade` step. An installed database gains an empty table and every
   * existing row is untouched — which is the whole reason a PDF is not a Note.
   * Representing documents in `notes` would have meant a migration that
   * rewrites rows the user has been editing for months.
   *
   * `&vaultPath` is unique because one file is one document: a second row for
   * the same path is the duplicate-on-rescan bug, and the database refuses it
   * rather than the service remembering to check.
   */
  {
    version: 3,
    stores: {
      vaultDocuments: 'id, &vaultPath, title, kind, importedAt, updatedAt, deletedAt',
    },
  },
]

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 1

/**
 * Applies a migration list to a Dexie instance. Kept separate from the database
 * class so tests can build a database from a fixture list and verify that data
 * survives an upgrade.
 */
export function applyMigrations(db: Dexie, migrations: MigrationDefinition[] = MIGRATIONS): void {
  for (const migration of migrations) {
    const version = db.version(migration.version).stores(migration.stores)
    if (migration.upgrade) version.upgrade(migration.upgrade)
  }
}
