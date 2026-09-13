import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import type { Id, Subtask } from '@/types/entities'
import { createRepository } from './baseRepository'

/**
 * Stores whose M1/M2 surface is exactly the base repository plus one or two
 * lookups. They grow their own file when the milestone that owns them lands —
 * `tasks` did in M3, `projects` in M4, `habits` in M7, `goals` and
 * `milestones` in M8, `notes` in M9, `vaultLinks` in M10.
 */

export const focusSessionRepo = createRepository('focusSessions')

const subtaskBase = createRepository('subtasks')
export const subtaskRepo = {
  ...subtaskBase,
  async byTask(taskId: Id): Promise<Subtask[]> {
    try {
      const rows = await db.subtasks.where('taskId').equals(taskId).toArray()
      return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.sortOrder - b.sortOrder)
    } catch (error) {
      throw toRepositoryError('subtasks', error, 'byTask')
    }
  },

  /** Highest order in use on one task, so a new subtask appends after it. */
  async lastOrder(taskId: Id): Promise<number | undefined> {
    const rows = await this.byTask(taskId)
    return rows[rows.length - 1]?.sortOrder
  },

  /** Removes every subtask of a task for good. Used when a task is purged. */
  async purgeForTask(taskId: Id): Promise<number> {
    try {
      const rows = await db.subtasks.where('taskId').equals(taskId).toArray()
      await db.subtasks.bulkDelete(rows.map((r) => r.id))
      return rows.length
    } catch (error) {
      throw toRepositoryError('subtasks', error, 'purgeForTask')
    }
  },
}
