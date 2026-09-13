import { beforeEach, describe, expect, it } from 'vitest'
import { taskRepo } from '@/repositories'
import { taskInput } from '../../tests/factories'
import { resetDatabase } from '../../tests/helpers'

beforeEach(resetDatabase)

const add = (title: string, extra: Parameters<typeof taskInput>[0] = {}) =>
  taskRepo.create(taskInput({ title, ...extra }), { emit: false })

describe('the read paths every view depends on', () => {
  it('finds tasks due on one day through the [status+dueDate] index', async () => {
    await add('Today', { dueDate: '2026-09-03' })
    await add('Tomorrow', { dueDate: '2026-09-04' })
    await add('Done today', { dueDate: '2026-09-03', status: 'done' })

    expect((await taskRepo.dueOn('2026-09-03')).map((t) => t.title)).toEqual(['Today'])
  })

  it('treats overdue as strictly before today', async () => {
    await add('Yesterday', { dueDate: '2026-09-02' })
    await add('Today', { dueDate: '2026-09-03' })

    expect((await taskRepo.overdue('2026-09-03')).map((t) => t.title)).toEqual(['Yesterday'])
  })

  it('reads an inclusive day range', async () => {
    await add('Before', { dueDate: '2026-09-03' })
    await add('Start', { dueDate: '2026-09-04' })
    await add('End', { dueDate: '2026-09-10' })
    await add('After', { dueDate: '2026-09-11' })

    const rows = await taskRepo.dueBetween('2026-09-04', '2026-09-10')
    expect(rows.map((t) => t.title)).toEqual(['Start', 'End'])
  })

  it('finds the unfiled open tasks, which null cannot be indexed for', async () => {
    await add('Unfiled', { sortOrder: 1000 })
    await add('Filed', { projectId: 'p1', sortOrder: 2000 })
    await add('Unfiled but done', { status: 'done', sortOrder: 3000 })

    expect((await taskRepo.inbox()).map((t) => t.title)).toEqual(['Unfiled'])
  })

  it('orders completed tasks by when they were finished, newest first', async () => {
    await add('Older', { status: 'done', completedAt: 1000 })
    await add('Newer', { status: 'done', completedAt: 5000 })

    expect((await taskRepo.completed()).map((t) => t.title)).toEqual(['Newer', 'Older'])
  })

  it('finds tasks by tag through the multi-entry index', async () => {
    await add('Tagged', { tagIds: ['t1', 't2'], sortOrder: 1000 })
    await add('Other tag', { tagIds: ['t2'], sortOrder: 2000 })
    await add('Untagged', { sortOrder: 3000 })

    expect((await taskRepo.byTag('t1')).map((t) => t.title)).toEqual(['Tagged'])
    expect((await taskRepo.byTag('t2')).map((t) => t.title)).toEqual(['Tagged', 'Other tag'])
  })

  it('reports the highest order in use so a new task can append', async () => {
    expect(await taskRepo.lastOrder()).toBeUndefined()
    await add('A', { sortOrder: 1000 })
    await add('B', { sortOrder: 7000 })
    expect(await taskRepo.lastOrder()).toBe(7000)
  })
})

describe('what every read path must hide', () => {
  it('hides soft-deleted tasks', async () => {
    const gone = await add('Gone', { dueDate: '2026-09-03' })
    await taskRepo.softDelete(gone.id, { emit: false })

    expect(await taskRepo.dueOn('2026-09-03')).toEqual([])
    expect(await taskRepo.listLive()).toEqual([])
    expect(await taskRepo.countOpen()).toBe(0)
  })

  it('hides recurrence templates, which are rows but never tasks', async () => {
    // The invisible template that will own a recurrence rule in M5 must never
    // appear in a list a person can complete.
    await add('Real', { dueDate: '2026-09-03', sortOrder: 1000 })
    await add('Template', { dueDate: '2026-09-03', isTemplate: true, sortOrder: 2000 })

    expect((await taskRepo.dueOn('2026-09-03')).map((t) => t.title)).toEqual(['Real'])
    expect((await taskRepo.listLive()).map((t) => t.title)).toEqual(['Real'])
    expect(await taskRepo.countOpen()).toBe(1)
  })
})

describe('respacing', () => {
  it('rewrites many orders in one transaction', async () => {
    const a = await add('A', { sortOrder: 1 })
    const b = await add('B', { sortOrder: 1.0001 })

    await taskRepo.respaceOrders([
      { id: a.id, sortOrder: 1000 },
      { id: b.id, sortOrder: 2000 },
    ])

    expect((await taskRepo.listLive()).map((t) => t.sortOrder)).toEqual([1000, 2000])
  })

  it('does nothing when given nothing', async () => {
    await expect(taskRepo.respaceOrders([])).resolves.toBeUndefined()
  })

  it('emits no events, because respacing is not a user action', async () => {
    const a = await add('A', { sortOrder: 1 })
    await taskRepo.respaceOrders([{ id: a.id, sortOrder: 9000 }])
    expect((await taskRepo.get(a.id))?.sortOrder).toBe(9000)
  })
})
