import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import type { DateStr, Id, Task } from '@/types/entities'
import { createRepository } from './baseRepository'

const base = createRepository('tasks')

/**
 * Templates are the invisible owners of a recurrence rule (M5). They are rows
 * in `tasks` but they are never a task you can see or complete, so every read
 * path filters them out here rather than in each of the six views.
 */
const live = (tasks: Task[]) => tasks.filter((t) => t.deletedAt === null && !t.isTemplate)

const byOrder = (tasks: Task[]) => tasks.sort((a, b) => a.sortOrder - b.sortOrder)

export const taskRepo = {
  ...base,

  /** Every live, non-template task. The six views are computed from this. */
  async listLive(): Promise<Task[]> {
    try {
      return byOrder(live(await db.tasks.toArray()))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'listLive')
    }
  },

  /** Open tasks due on a given day. Index hit on [status+dueDate]. */
  async dueOn(date: DateStr): Promise<Task[]> {
    try {
      const rows = await db.tasks.where('[status+dueDate]').equals(['todo', date]).toArray()
      return byOrder(live(rows))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'dueOn')
    }
  },

  /** Open tasks whose due date is strictly before a given day. */
  async overdue(today: DateStr): Promise<Task[]> {
    try {
      const rows = await db.tasks
        .where('[status+dueDate]')
        .between(['todo', ''], ['todo', today], true, false)
        .toArray()
      return byOrder(live(rows))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'overdue')
    }
  },

  /** Open tasks due within an inclusive day range. Powers Upcoming. */
  async dueBetween(from: DateStr, to: DateStr): Promise<Task[]> {
    try {
      const rows = await db.tasks
        .where('[status+dueDate]')
        .between(['todo', from], ['todo', to], true, true)
        .toArray()
      return byOrder(live(rows))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'dueBetween')
    }
  },

  /**
   * Open tasks with no project. `projectId` is nullable, so null rows are
   * absent from that index entirely — a table read is the only correct query.
   */
  async inbox(): Promise<Task[]> {
    try {
      const rows = await db.tasks.where('status').equals('todo').toArray()
      return byOrder(live(rows).filter((t) => t.projectId === null))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'inbox')
    }
  },

  /**
   * Every live task with a due date inside an inclusive range, **open and
   * completed alike**.
   *
   * `dueBetween` deliberately constrains to `todo` through the
   * `[status+dueDate]` index, which is right for Upcoming but wrong for a
   * calendar: a day that hides what you finished on it is a day that lies about
   * what happened. This uses the plain `dueDate` index instead, so one query
   * serves a whole visible period.
   */
  async dueInRange(from: DateStr, to: DateStr): Promise<Task[]> {
    try {
      const rows = await db.tasks.where('dueDate').between(from, to, true, true).toArray()
      return byOrder(live(rows))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'dueInRange')
    }
  },

  /**
   * Live tasks with no due date at all.
   *
   * `dueDate` is nullable, so undated rows are absent from that index entirely
   * — a table read is the only correct query, the same reason `inbox()` does
   * one.
   */
  async undated(): Promise<Task[]> {
    try {
      return byOrder(live(await db.tasks.toArray()).filter((task) => task.dueDate === null))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'undated')
    }
  },

  async byStatus(status: Task['status']): Promise<Task[]> {
    try {
      return byOrder(live(await db.tasks.where('status').equals(status).toArray()))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'byStatus')
    }
  },

  /** Completed tasks, most recently finished first. */
  async completed(): Promise<Task[]> {
    try {
      const rows = live(await db.tasks.where('status').equals('done').toArray())
      return rows.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'completed')
    }
  },

  async byProject(projectId: Id): Promise<Task[]> {
    try {
      return byOrder(live(await db.tasks.where('projectId').equals(projectId).toArray()))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'byProject')
    }
  },

  /** Uses the multi-entry *tagIds index rather than scanning every row. */
  async byTag(tagId: Id): Promise<Task[]> {
    try {
      return byOrder(live(await db.tasks.where('tagIds').equals(tagId).toArray()))
    } catch (error) {
      throw toRepositoryError('tasks', error, 'byTag')
    }
  },

  /** Highest manual order in use, so a new task can be appended after it. */
  async lastOrder(): Promise<number | undefined> {
    try {
      const rows = await db.tasks.orderBy('sortOrder').last()
      return rows?.sortOrder
    } catch (error) {
      throw toRepositoryError('tasks', error, 'lastOrder')
    }
  },

  async countOpen(): Promise<number> {
    try {
      return live(await db.tasks.where('status').equals('todo').toArray()).length
    } catch (error) {
      throw toRepositoryError('tasks', error, 'countOpen')
    }
  },

  async countCompleted(): Promise<number> {
    try {
      return live(await db.tasks.where('status').equals('done').toArray()).length
    } catch (error) {
      throw toRepositoryError('tasks', error, 'countCompleted')
    }
  },

  /**
   * Rewrites `sortOrder` on many rows in one transaction. Only used to respace
   * a list that has exhausted midpoint precision — an ordinary drag updates a
   * single row, which is the whole point of the midpoint strategy.
   */
  async respaceOrders(orders: { id: Id; sortOrder: number }[]): Promise<void> {
    if (orders.length === 0) return
    try {
      await db.transaction('rw', [db.tasks], async () => {
        for (const { id, sortOrder } of orders) {
          const current = await db.tasks.get(id)
          if (current) await db.tasks.put({ ...current, sortOrder })
        }
      })
    } catch (error) {
      throw toRepositoryError('tasks', error, 'respaceOrders')
    }
  },
}
