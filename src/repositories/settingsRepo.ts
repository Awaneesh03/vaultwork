import { db } from '@/db'
import { DEFAULT_SETTINGS } from '@/db/seed'
import { nowTs } from '@/lib/date'
import { toRepositoryError } from '@/lib/errors'
import type { Settings } from '@/types/entities'
import type { EventSource } from '@/types/enums'
import { appendEvent } from './baseRepository'

export const SETTINGS_ID = 'singleton'

/**
 * The fallback handed back while no row exists yet.
 *
 * Memoised so two reads of an unseeded database return the same object rather
 * than two defaults with different `createdAt` stamps — a live query that saw a
 * new object on every run would re-render forever.
 */
let fallback: Settings | null = null

/**
 * A single row. Callers never see null: an unseeded database reads as the
 * defaults.
 *
 * `get` is **read-only**, and that is load-bearing rather than stylistic.
 * Dexie runs a `liveQuery` querier in a read-only transaction and throws
 * `ReadOnlyError` if it attempts a write, so a getter that lazily created its
 * own row crashed every live query that touched settings on a database where
 * the row was missing. Creation is now `ensure`, called once at start-up by
 * whoever is allowed to write.
 */
export const settingsRepo = {
  async get(): Promise<Settings> {
    try {
      const existing = await db.settings.get(SETTINGS_ID)
      if (existing) {
        fallback = null
        return existing
      }
      fallback ??= DEFAULT_SETTINGS()
      return fallback
    } catch (error) {
      throw toRepositoryError('settings', error, 'get')
    }
  },

  /** Creates the singleton if it is missing. Start-up only — this writes. */
  async ensure(): Promise<Settings> {
    try {
      const existing = await db.settings.get(SETTINGS_ID)
      if (existing) return existing
      const created = DEFAULT_SETTINGS()
      await db.settings.add(created)
      fallback = null
      return created
    } catch (error) {
      throw toRepositoryError('settings', error, 'ensure')
    }
  },

  async update(
    patch: Partial<Omit<Settings, 'id' | 'createdAt'>>,
    source: EventSource = 'ui',
  ): Promise<Settings> {
    try {
      let next!: Settings
      await db.transaction('rw', [db.settings, db.events], async () => {
        const current = (await db.settings.get(SETTINGS_ID)) ?? DEFAULT_SETTINGS()
        next = { ...current, ...patch, id: SETTINGS_ID, updatedAt: nowTs() }
        await db.settings.put(next)
        await appendEvent({
          type: 'settings.updated',
          entityType: 'settings',
          entityId: SETTINGS_ID,
          source,
          payload: { fields: Object.keys(patch) },
        })
      })
      return next
    } catch (error) {
      throw toRepositoryError('settings', error, 'update')
    }
  },
}
