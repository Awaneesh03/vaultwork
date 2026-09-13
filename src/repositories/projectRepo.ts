import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import type { Id, Project } from '@/types/entities'
import { createRepository } from './baseRepository'

const base = createRepository('projects')

/**
 * Projects.
 *
 * Two things are worth knowing before reading further.
 *
 * **Archived is a status, not a second flag.** `ProjectStatus` already carries
 * `archived`, so there is no `archivedAt` column and no way for a project to be
 * archived and active at the same time. Which status a project *returns to* is
 * recovered from the event log by the service — history is already append-only,
 * so storing a "previous status" column would be a second copy of a fact the
 * log holds better.
 *
 * **Archiving and deleting are different operations on different fields.**
 * `status` says whether a project is in play; `deletedAt` says whether it
 * exists. Every read below filters on `deletedAt` and leaves `status` to the
 * caller, so "archived" can never accidentally mean "gone".
 */

const live = (rows: Project[]) => rows.filter((row) => row.deletedAt === null)

const byOrder = (rows: Project[]) =>
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)

const normalise = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

export const projectRepo = {
  ...base,

  /** Every live project, archived ones included. Ordered by `sortOrder`. */
  async listLive(): Promise<Project[]> {
    try {
      return byOrder(live(await db.projects.toArray()))
    } catch (error) {
      throw toRepositoryError('projects', error, 'listLive')
    }
  },

  /**
   * Live projects that are not archived — the default Projects list.
   *
   * Derived in memory from one table read rather than a `notEqual` scan: there
   * are tens of projects, not thousands, and one read serves both this and
   * `listArchived` when a caller wants both.
   */
  async listActive(): Promise<Project[]> {
    try {
      return byOrder(live(await db.projects.toArray()).filter((row) => row.status !== 'archived'))
    } catch (error) {
      throw toRepositoryError('projects', error, 'listActive')
    }
  },

  /** Live projects that have been archived. Index hit on `status`. */
  async listArchived(): Promise<Project[]> {
    try {
      const rows = await db.projects.where('status').equals('archived').toArray()
      return byOrder(live(rows))
    } catch (error) {
      throw toRepositoryError('projects', error, 'listArchived')
    }
  },

  /**
   * Name lookup, case- and whitespace-insensitive.
   *
   * `name` carries no unique index — unlike tags, two projects called "Notes"
   * are a mistake rather than a structural impossibility, and a unique index
   * would make a soft-deleted project squat on its name forever. Duplicates are
   * therefore refused by the service, which can explain itself.
   */
  async findByName(
    name: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<Project | undefined> {
    const wanted = normalise(name)
    if (wanted.length === 0) return undefined
    try {
      const rows = await db.projects.toArray()
      const pool = options.includeDeleted ? rows : live(rows)
      return byOrder(pool).find((row) => normalise(row.name) === wanted)
    } catch (error) {
      throw toRepositoryError('projects', error, 'findByName')
    }
  },

  /** Highest manual order in use, so a new project appends after it. */
  async lastOrder(): Promise<number | undefined> {
    try {
      const rows = await this.listLive()
      return rows[rows.length - 1]?.sortOrder
    } catch (error) {
      throw toRepositoryError('projects', error, 'lastOrder')
    }
  },

  /** How many live tasks point at a project, split by status. */
  async taskCounts(projectId: Id): Promise<{ total: number; open: number; done: number }> {
    try {
      const rows = (await db.tasks.where('projectId').equals(projectId).toArray()).filter(
        (task) => task.deletedAt === null && !task.isTemplate,
      )
      const done = rows.filter((task) => task.status === 'done').length
      return { total: rows.length, open: rows.length - done, done }
    } catch (error) {
      throw toRepositoryError('projects', error, 'taskCounts')
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
      await db.transaction('rw', [db.projects], async () => {
        for (const { id, sortOrder } of orders) {
          const current = await db.projects.get(id)
          if (current) await db.projects.put({ ...current, sortOrder })
        }
      })
    } catch (error) {
      throw toRepositoryError('projects', error, 'respaceOrders')
    }
  },
}
