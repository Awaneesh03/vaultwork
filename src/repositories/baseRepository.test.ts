import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { NotFoundError, RepositoryError } from '@/lib/errors'
import { isId } from '@/lib/id'
import { eventRepo, projectRepo, taskRepo } from '@/repositories'
import { projectInput, taskInput } from '../../tests/factories'
import { resetDatabase } from '../../tests/helpers'

beforeEach(resetDatabase)

describe('create', () => {
  it('assigns a UUID and both timestamps', async () => {
    const before = Date.now()
    const task = await taskRepo.create(taskInput())

    expect(isId(task.id)).toBe(true)
    expect(task.createdAt).toBeGreaterThanOrEqual(before)
    expect(task.updatedAt).toBe(task.createdAt)
    expect(task.deletedAt).toBeNull()
  })

  it('honours a caller-supplied id, which is what import relies on', async () => {
    const id = crypto.randomUUID()
    const withId = await taskRepo.create({ ...taskInput({ title: 'Explicit' }), id })

    expect(withId.id).toBe(id)
    expect(await taskRepo.get(id)).toMatchObject({ title: 'Explicit' })
  })

  it('writes a created event carrying the source', async () => {
    const task = await taskRepo.create(taskInput(), { source: 'quickadd' })
    const events = await eventRepo.list()

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'task.created',
      entityType: 'task',
      entityId: task.id,
      source: 'quickadd',
    })
  })

  it('defaults the source to the UI', async () => {
    await taskRepo.create(taskInput())
    const [event] = await eventRepo.list()
    expect(event?.source).toBe('ui')
  })

  it('can be told not to emit, for bulk paths', async () => {
    await taskRepo.create(taskInput(), { emit: false })
    expect(await eventRepo.count()).toBe(0)
  })
})

describe('read', () => {
  it('sorts a list by sortOrder', async () => {
    await taskRepo.create(taskInput({ title: 'third', sortOrder: 3000 }))
    await taskRepo.create(taskInput({ title: 'first', sortOrder: 1000 }))
    await taskRepo.create(taskInput({ title: 'second', sortOrder: 2000 }))

    expect((await taskRepo.list()).map((t) => t.title)).toEqual(['first', 'second', 'third'])
  })

  it('throws NotFoundError for a missing id', async () => {
    await expect(taskRepo.getOrThrow(crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('update', () => {
  it('changes fields, bumps updatedAt and leaves createdAt alone', async () => {
    const task = await taskRepo.create(taskInput())
    await new Promise((resolve) => setTimeout(resolve, 2))

    const updated = await taskRepo.update(task.id, { title: 'Study Graphs', priority: 'high' })

    expect(updated.title).toBe('Study Graphs')
    expect(updated.priority).toBe('high')
    expect(updated.createdAt).toBe(task.createdAt)
    expect(updated.updatedAt).toBeGreaterThan(task.createdAt)
  })

  it('records which fields changed', async () => {
    const task = await taskRepo.create(taskInput(), { emit: false })
    await taskRepo.update(task.id, { priority: 'urgent' })

    const [event] = await eventRepo.list()
    expect(event?.type).toBe('task.updated')
    expect(event?.payload).toEqual({ fields: ['priority'] })
  })

  it('refuses to update a soft-deleted row', async () => {
    const task = await taskRepo.create(taskInput())
    await taskRepo.softDelete(task.id)
    await expect(taskRepo.update(task.id, { title: 'zombie' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('soft delete', () => {
  it('hides the row without removing it', async () => {
    const task = await taskRepo.create(taskInput())
    await taskRepo.softDelete(task.id)

    expect(await taskRepo.get(task.id)).toBeUndefined()
    expect(await taskRepo.list()).toHaveLength(0)
    expect(await taskRepo.count()).toBe(0)

    const stored = await taskRepo.get(task.id, { includeDeleted: true })
    expect(stored?.deletedAt).toBeTypeOf('number')

    // The row is still physically present — that is what makes undo possible.
    expect(await db.tasks.count()).toBe(1)
  })

  it('lists deleted rows through the deletedAt index', async () => {
    const kept = await taskRepo.create(taskInput({ title: 'kept' }))
    const removed = await taskRepo.create(taskInput({ title: 'removed' }))
    await taskRepo.softDelete(removed.id)

    const deleted = await taskRepo.listDeleted()
    expect(deleted.map((t) => t.id)).toEqual([removed.id])
    expect(await taskRepo.get(kept.id)).toBeDefined()
  })

  it('restores a deleted row, which is what the undo toast calls', async () => {
    const task = await taskRepo.create(taskInput())
    await taskRepo.softDelete(task.id)
    const restored = await taskRepo.restore(task.id)

    expect(restored.deletedAt).toBeNull()
    expect(await taskRepo.get(task.id)).toBeDefined()

    const types = (await eventRepo.list()).map((e) => e.type)
    expect(types).toContain('task.deleted')
    expect(types).toContain('task.restored')
  })

  it('refuses to delete twice', async () => {
    const task = await taskRepo.create(taskInput())
    await taskRepo.softDelete(task.id)
    await expect(taskRepo.softDelete(task.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('removes the row permanently on hardDelete', async () => {
    const task = await taskRepo.create(taskInput())
    await taskRepo.hardDelete(task.id)
    expect(await db.tasks.count()).toBe(0)
  })
})

describe('indexed queries', () => {
  it('finds tasks due on a day and overdue ones separately', async () => {
    await taskRepo.create(taskInput({ title: 'today', dueDate: '2026-09-03' }))
    await taskRepo.create(taskInput({ title: 'late', dueDate: '2026-09-01' }))
    await taskRepo.create(taskInput({ title: 'later', dueDate: '2026-09-10' }))
    await taskRepo.create(
      taskInput({ title: 'done already', dueDate: '2026-09-01', status: 'done' }),
    )

    expect((await taskRepo.dueOn('2026-09-03')).map((t) => t.title)).toEqual(['today'])
    expect((await taskRepo.overdue('2026-09-03')).map((t) => t.title)).toEqual(['late'])
  })

  it('excludes soft-deleted rows from indexed queries too', async () => {
    const task = await taskRepo.create(taskInput({ dueDate: '2026-09-03' }))
    await taskRepo.softDelete(task.id)
    expect(await taskRepo.dueOn('2026-09-03')).toHaveLength(0)
  })

  it('keeps stores independent', async () => {
    await projectRepo.create(projectInput())
    await taskRepo.create(taskInput())

    expect(await projectRepo.count()).toBe(1)
    expect(await taskRepo.count()).toBe(1)
    const types = (await eventRepo.list()).map((e) => e.type)
    expect(types).toContain('project.created')
    expect(types).toContain('task.created')
  })
})

describe('error translation', () => {
  it('wraps failures in a RepositoryError naming the store', async () => {
    const task = await taskRepo.create(taskInput())
    // A duplicate primary key is the simplest way to make Dexie refuse.
    const error = await taskRepo.create({ ...taskInput(), id: task.id }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(RepositoryError)
    expect((error as RepositoryError).store).toBe('tasks')
  })
})
