import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { projectRepo, taskRepo } from '@/repositories'
import { projectInput, taskInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'

/**
 * The project store, against a real IndexedDB.
 *
 * What is worth pinning here is everything the base repository does *not* give
 * for free: the split between `status` and `deletedAt`, the ordering, and the
 * name lookup that has to work without a unique index.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

describe('CRUD', () => {
  it('creates a row with generated id, timestamps and a null deletedAt', async () => {
    const project = await projectRepo.create(projectInput({ name: 'College' }))

    expect(project.id).toMatch(/[0-9a-f-]{36}/)
    expect(project.createdAt).toBeGreaterThan(0)
    expect(project.updatedAt).toBe(project.createdAt)
    expect(project.deletedAt).toBeNull()
    expect(await projectRepo.get(project.id)).toMatchObject({ name: 'College' })
  })

  it('updates in place, keeping the id and bumping updatedAt', async () => {
    const project = await projectRepo.create(projectInput({ name: 'College' }))
    const updated = await projectRepo.update(project.id, { name: 'Semester 5' })

    expect(updated.id).toBe(project.id)
    expect(updated.name).toBe('Semester 5')
    expect(updated.updatedAt).toBeGreaterThan(project.updatedAt)
    expect(await projectRepo.count()).toBe(1)
  })

  it('counts only live rows', async () => {
    const a = await projectRepo.create(projectInput({ name: 'A' }))
    await projectRepo.create(projectInput({ name: 'B' }))
    await projectRepo.softDelete(a.id)

    expect(await projectRepo.count()).toBe(1)
    expect(await db.projects.count()).toBe(2)
  })
})

describe('soft deletion', () => {
  it('stamps deletedAt and keeps the row in the table', async () => {
    const project = await projectRepo.create(projectInput())
    await projectRepo.softDelete(project.id)

    expect(await projectRepo.get(project.id)).toBeUndefined()
    expect(await projectRepo.get(project.id, { includeDeleted: true })).toBeDefined()
    expect((await db.projects.get(project.id))?.deletedAt).toBeGreaterThan(0)
  })

  it('lists what has been deleted, and restores it', async () => {
    const project = await projectRepo.create(projectInput({ name: 'Portfolio' }))
    await projectRepo.softDelete(project.id)

    expect((await projectRepo.listDeleted()).map((row) => row.name)).toEqual(['Portfolio'])

    const restored = await projectRepo.restore(project.id)
    expect(restored.deletedAt).toBeNull()
    expect(await projectRepo.listDeleted()).toEqual([])
  })

  it('leaves a deleted project out of every live read', async () => {
    const project = await projectRepo.create(projectInput({ name: 'Gone' }))
    await projectRepo.create(projectInput({ name: 'Here' }))
    await projectRepo.softDelete(project.id)

    expect((await projectRepo.listLive()).map((row) => row.name)).toEqual(['Here'])
    expect((await projectRepo.listActive()).map((row) => row.name)).toEqual(['Here'])
  })
})

describe('ordering', () => {
  it('lists in sortOrder, not insertion order', async () => {
    await projectRepo.create(projectInput({ name: 'third', sortOrder: 3000 }))
    await projectRepo.create(projectInput({ name: 'first', sortOrder: 1000 }))
    await projectRepo.create(projectInput({ name: 'second', sortOrder: 2000 }))

    expect((await projectRepo.listLive()).map((row) => row.name)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('reports the highest order in use so a new project can append', async () => {
    expect(await projectRepo.lastOrder()).toBeUndefined()
    await projectRepo.create(projectInput({ name: 'a', sortOrder: 1000 }))
    await projectRepo.create(projectInput({ name: 'b', sortOrder: 4000 }))
    expect(await projectRepo.lastOrder()).toBe(4000)
  })

  it('respaces a whole list in one transaction', async () => {
    const a = await projectRepo.create(projectInput({ name: 'a', sortOrder: 1000 }))
    const b = await projectRepo.create(projectInput({ name: 'b', sortOrder: 1000.0001 }))

    await projectRepo.respaceOrders([
      { id: a.id, sortOrder: 1000 },
      { id: b.id, sortOrder: 2000 },
    ])

    expect((await projectRepo.listLive()).map((row) => row.sortOrder)).toEqual([1000, 2000])
  })

  it('breaks a sortOrder tie by creation time, so the order is total', async () => {
    const a = await projectRepo.create(projectInput({ name: 'a', sortOrder: 1000 }))
    const b = await projectRepo.create(projectInput({ name: 'b', sortOrder: 1000 }))

    expect(a.createdAt).toBeLessThan(b.createdAt)
    expect((await projectRepo.listLive()).map((row) => row.name)).toEqual(['a', 'b'])
  })
})

describe('active and archived', () => {
  beforeEach(async () => {
    await projectRepo.create(projectInput({ name: 'Active', status: 'active', sortOrder: 1000 }))
    await projectRepo.create(
      projectInput({ name: 'Planning', status: 'planning', sortOrder: 2000 }),
    )
    await projectRepo.create(
      projectInput({ name: 'Archived', status: 'archived', sortOrder: 3000 }),
    )
  })

  it('treats every non-archived status as active', async () => {
    expect((await projectRepo.listActive()).map((row) => row.name)).toEqual([
      'Active',
      'Planning',
    ])
  })

  it('lists the archive on its own', async () => {
    expect((await projectRepo.listArchived()).map((row) => row.name)).toEqual(['Archived'])
  })

  it('includes both in listLive — archived is not deleted', async () => {
    expect(await projectRepo.listLive()).toHaveLength(3)
  })
})

describe('name lookup', () => {
  it('ignores case and repeated whitespace', async () => {
    await projectRepo.create(projectInput({ name: 'DSA Mastery' }))

    expect((await projectRepo.findByName('dsa mastery'))?.name).toBe('DSA Mastery')
    expect((await projectRepo.findByName('  DSA   Mastery '))?.name).toBe('DSA Mastery')
    expect(await projectRepo.findByName('DSA')).toBeUndefined()
  })

  it('does not let a deleted project squat on its name', async () => {
    const project = await projectRepo.create(projectInput({ name: 'College' }))
    await projectRepo.softDelete(project.id)

    expect(await projectRepo.findByName('College')).toBeUndefined()
    expect((await projectRepo.findByName('College', { includeDeleted: true }))?.id).toBe(
      project.id,
    )
  })

  it('finds an archived project, which still owns its name', async () => {
    await projectRepo.create(projectInput({ name: 'College', status: 'archived' }))
    expect((await projectRepo.findByName('college'))?.status).toBe('archived')
  })

  it('returns nothing for a blank query rather than the first row', async () => {
    await projectRepo.create(projectInput({ name: 'College' }))
    expect(await projectRepo.findByName('   ')).toBeUndefined()
  })
})

describe('task counts', () => {
  it('counts live, non-template tasks split by status', async () => {
    const project = await projectRepo.create(projectInput())
    await taskRepo.create(taskInput({ title: 'open', projectId: project.id }))
    await taskRepo.create(taskInput({ title: 'done', projectId: project.id, status: 'done' }))
    const deleted = await taskRepo.create(taskInput({ title: 'gone', projectId: project.id }))
    await taskRepo.softDelete(deleted.id)
    await taskRepo.create(
      taskInput({ title: 'template', projectId: project.id, isTemplate: true }),
    )
    await taskRepo.create(taskInput({ title: 'elsewhere' }))

    expect(await projectRepo.taskCounts(project.id)).toEqual({ total: 2, open: 1, done: 1 })
  })

  it('reports zeroes for a project nothing points at', async () => {
    const project = await projectRepo.create(projectInput())
    expect(await projectRepo.taskCounts(project.id)).toEqual({ total: 0, open: 0, done: 0 })
  })
})
