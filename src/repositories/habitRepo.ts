import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import type { DateStr, Habit, HabitEntry, Id } from '@/types/entities'
import { createRepository } from './baseRepository'

const habitBase = createRepository('habits')
const entryBase = createRepository('habitEntries')

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((row) => row.deletedAt === null)

const byOrder = (rows: Habit[]) =>
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)

/**
 * Habits.
 *
 * Two independent flags, as the M1 model defines them: `archivedAt` says
 * whether a habit is still being tracked, `deletedAt` says whether it exists.
 * Every read below filters on `deletedAt` and leaves `archivedAt` to the
 * caller, so "archived" can never quietly come to mean "gone".
 */
export const habitRepo = {
  ...habitBase,

  /** Every live habit, archived ones included, in manual order. */
  async listLive(): Promise<Habit[]> {
    try {
      return byOrder(live(await db.habits.toArray()))
    } catch (error) {
      throw toRepositoryError('habits', error, 'listLive')
    }
  },

  /** Live habits still being tracked — what "today" is built from. */
  async listActive(): Promise<Habit[]> {
    try {
      return byOrder(live(await db.habits.toArray()).filter((row) => row.archivedAt === null))
    } catch (error) {
      throw toRepositoryError('habits', error, 'listActive')
    }
  },

  async listArchived(): Promise<Habit[]> {
    try {
      return byOrder(live(await db.habits.toArray()).filter((row) => row.archivedAt !== null))
    } catch (error) {
      throw toRepositoryError('habits', error, 'listArchived')
    }
  },

  /** Highest manual order in use, so a new habit appends after it. */
  async lastOrder(): Promise<number | undefined> {
    const rows = await this.listLive()
    return rows[rows.length - 1]?.sortOrder
  },

  /**
   * Rewrites `sortOrder` on many rows in one transaction. Only used to respace
   * a list that has exhausted midpoint precision — the same strategy tasks and
   * projects use, and for the same reason.
   */
  async respaceOrders(orders: { id: Id; sortOrder: number }[]): Promise<void> {
    if (orders.length === 0) return
    try {
      await db.transaction('rw', [db.habits], async () => {
        for (const { id, sortOrder } of orders) {
          const current = await db.habits.get(id)
          if (current) await db.habits.put({ ...current, sortOrder })
        }
      })
    } catch (error) {
      throw toRepositoryError('habits', error, 'respaceOrders')
    }
  },
}

/**
 * Habit entries — the record of what actually happened.
 *
 * The store carries `&[habitId+date]`, a **unique** compound index, so two rows
 * for one habit on one day are impossible at the database level rather than by
 * convention. `logOnce` leans on that: it reads, then either updates the row it
 * found or adds a new one, all inside one `rw` transaction, so two clicks
 * racing each other cannot both win.
 *
 * Nothing here ever creates an entry for a day that has not happened. There is
 * no code path that materialises a future occurrence, which is the difference
 * between a habit tracker and a task generator.
 */
export const habitEntryRepo = {
  ...entryBase,

  /** Relies on the unique [habitId+date] index rather than a read-then-scan. */
  async forHabitOnDate(habitId: Id, date: DateStr): Promise<HabitEntry | undefined> {
    try {
      const row = await db.habitEntries.where('[habitId+date]').equals([habitId, date]).first()
      return row && row.deletedAt === null ? row : undefined
    } catch (error) {
      throw toRepositoryError('habitEntries', error, 'forHabitOnDate')
    }
  },

  /**
   * Every live entry in an inclusive date range, across **all** habits.
   *
   * One indexed query serves a whole screen: the habits list needs today plus a
   * month of history for every habit it shows, and asking per habit would be an
   * N+1 read that gets slower with every habit the user adds.
   */
  async inRange(from: DateStr, to: DateStr): Promise<HabitEntry[]> {
    try {
      const rows = await db.habitEntries.where('date').between(from, to, true, true).toArray()
      return live(rows)
    } catch (error) {
      throw toRepositoryError('habitEntries', error, 'inRange')
    }
  },

  /** One habit's entries in a range, oldest first. */
  async forHabitInRange(habitId: Id, from: DateStr, to: DateStr): Promise<HabitEntry[]> {
    const rows = await this.inRange(from, to)
    return rows
      .filter((row) => row.habitId === habitId)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  },

  /** Every live entry a habit has ever had. Used only when history is exported. */
  async forHabit(habitId: Id): Promise<HabitEntry[]> {
    try {
      const rows = await db.habitEntries.where('habitId').equals(habitId).toArray()
      return live(rows).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    } catch (error) {
      throw toRepositoryError('habitEntries', error, 'forHabit')
    }
  },

  /**
   * Records one habit on one date, exactly once.
   *
   * Idempotent by construction: the read and the write share a transaction, so
   * a second call updates the row the first created rather than racing it into
   * a constraint error. Returns whether a row was created, so the service can
   * decide whether anything actually happened and skip the event if not.
   */
  async logOnce(
    habitId: Id,
    date: DateStr,
    value: number,
    note: string | null,
    at: number,
  ): Promise<{ entry: HabitEntry; created: boolean; changed: boolean }> {
    try {
      let result!: { entry: HabitEntry; created: boolean; changed: boolean }

      await db.transaction('rw', [db.habitEntries], async () => {
        const existing = await db.habitEntries
          .where('[habitId+date]')
          .equals([habitId, date])
          .first()

        if (existing) {
          const revived = existing.deletedAt !== null
          const changed = revived || existing.value !== value || existing.note !== note
          const entry: HabitEntry = {
            ...existing,
            value,
            note,
            deletedAt: null,
            updatedAt: changed ? at : existing.updatedAt,
          }
          if (changed) await db.habitEntries.put(entry)
          result = { entry, created: revived, changed }
          return
        }

        const entry: HabitEntry = {
          id: crypto.randomUUID(),
          habitId,
          date,
          value,
          note,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
        }
        await db.habitEntries.add(entry)
        result = { entry, created: true, changed: true }
      })

      return result
    } catch (error) {
      throw toRepositoryError('habitEntries', error, 'logOnce')
    }
  },

  /**
   * Removes one day's record for good.
   *
   * A hard delete rather than a soft one, and deliberately: the unique
   * `[habitId+date]` index is occupied by a soft-deleted row, so a tombstone
   * would block the user from ever re-recording that day. "I did not do this
   * after all" is the absence of a row, which is exactly how every other
   * uncompleted day is represented.
   */
  async clear(habitId: Id, date: DateStr): Promise<boolean> {
    try {
      let removed = false
      await db.transaction('rw', [db.habitEntries], async () => {
        const existing = await db.habitEntries
          .where('[habitId+date]')
          .equals([habitId, date])
          .first()
        if (!existing) return
        await db.habitEntries.delete(existing.id)
        removed = true
      })
      return removed
    } catch (error) {
      throw toRepositoryError('habitEntries', error, 'clear')
    }
  },

  /** How many live entries a habit holds. Used before a delete, to say so. */
  async countForHabit(habitId: Id): Promise<number> {
    return (await this.forHabit(habitId)).length
  },
}
