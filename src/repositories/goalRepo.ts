import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import type { Goal, Id, Milestone, Task } from '@/types/entities'
import { createRepository } from './baseRepository'

const goalBase = createRepository('goals')
const milestoneBase = createRepository('milestones')

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((row) => row.deletedAt === null)

const byOrder = <T extends { sortOrder: number; createdAt: number }>(rows: T[]) =>
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)

/**
 * Goals.
 *
 * `status` and `deletedAt` are independent, exactly as `archivedAt` and
 * `deletedAt` are for habits: status says how a goal is being pursued, and
 * `deletedAt` says whether it exists at all. Every read here filters only on
 * `deletedAt` and hands `status` to the caller, so archiving a goal can never
 * quietly become deleting it.
 */
export const goalRepo = {
  ...goalBase,

  /** Every live goal in manual order, whatever its status. */
  async listLive(): Promise<Goal[]> {
    try {
      return byOrder(live(await db.goals.toArray()))
    } catch (error) {
      throw toRepositoryError('goals', error, 'listLive')
    }
  },

  /** Highest manual order in use, so a new goal appends after it. */
  async lastOrder(): Promise<number | undefined> {
    const rows = await this.listLive()
    return rows[rows.length - 1]?.sortOrder
  },

  async respaceOrders(orders: { id: Id; sortOrder: number }[]): Promise<void> {
    if (orders.length === 0) return
    try {
      await db.transaction('rw', [db.goals], async () => {
        for (const { id, sortOrder } of orders) {
          const current = await db.goals.get(id)
          if (current) await db.goals.put({ ...current, sortOrder })
        }
      })
    } catch (error) {
      throw toRepositoryError('goals', error, 'respaceOrders')
    }
  },
}

/**
 * Milestones — the checkpoints of exactly one goal.
 *
 * `Milestone.goalId` is not nullable in the M1 model, so a milestone without a
 * parent is unrepresentable and there is no "orphan milestone" state to guard
 * against. The store carries a `goalId` index, which is what makes `byGoal` a
 * lookup rather than a table scan.
 */
export const milestoneRepo = {
  ...milestoneBase,

  /** One goal's live milestones, in manual order. */
  async byGoal(goalId: Id): Promise<Milestone[]> {
    try {
      return byOrder(live(await db.milestones.where('goalId').equals(goalId).toArray()))
    } catch (error) {
      throw toRepositoryError('milestones', error, 'byGoal')
    }
  },

  /** Every live milestone across all goals — one read for a whole screen. */
  async listLive(): Promise<Milestone[]> {
    try {
      return byOrder(live(await db.milestones.toArray()))
    } catch (error) {
      throw toRepositoryError('milestones', error, 'listLive')
    }
  },

  /** Highest order within one goal, so a new milestone appends to that goal. */
  async lastOrder(goalId: Id): Promise<number | undefined> {
    const rows = await this.byGoal(goalId)
    return rows[rows.length - 1]?.sortOrder
  },

  async respaceOrders(orders: { id: Id; sortOrder: number }[]): Promise<void> {
    if (orders.length === 0) return
    try {
      await db.transaction('rw', [db.milestones], async () => {
        for (const { id, sortOrder } of orders) {
          const current = await db.milestones.get(id)
          if (current) await db.milestones.put({ ...current, sortOrder })
        }
      })
    } catch (error) {
      throw toRepositoryError('milestones', error, 'respaceOrders')
    }
  },

  /**
   * Live tasks pointing at one milestone.
   *
   * Reads the `milestoneId` index that already exists on `tasks`. It lives here
   * rather than on the task repository because the question is "what belongs to
   * this checkpoint?", and it only ever *reads* tasks — nothing in the goal
   * feature writes to a task except through TaskService.
   */
  async tasksFor(milestoneId: Id): Promise<Task[]> {
    try {
      return live(await db.tasks.where('milestoneId').equals(milestoneId).toArray())
    } catch (error) {
      throw toRepositoryError('milestones', error, 'tasksFor')
    }
  },

  /** How many live tasks point at a milestone. Asked before deleting one. */
  async countTasks(milestoneId: Id): Promise<number> {
    return (await this.tasksFor(milestoneId)).length
  },
}
