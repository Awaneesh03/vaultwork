import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { goalRepo, milestoneRepo, taskRepo } from '@/repositories'
import { taskInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'

/**
 * The goal and milestone stores, against a real IndexedDB.
 *
 * The property worth proving here is that `status` and `deletedAt` stay
 * independent: archiving a goal must leave it in every live read, and deleting
 * one must not touch its status. Everything downstream — the list filters, the
 * dashboard counts, restore — depends on those two never being conflated.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const goalInput = (overrides: Record<string, unknown> = {}) => ({
  title: 'Become strong in DSA',
  why: null,
  horizon: 'long' as const,
  status: 'active' as const,
  targetDate: null,
  sortOrder: 1000,
  vaultPath: null,
  ...overrides,
})

const milestoneInput = (goalId: string, overrides: Record<string, unknown> = {}) => ({
  goalId,
  title: 'Trees',
  targetDate: null,
  done: false,
  sortOrder: 1000,
  ...overrides,
})

describe('goal CRUD', () => {
  it('creates, reads and updates in place', async () => {
    const goal = await goalRepo.create(goalInput())
    expect(goal.deletedAt).toBeNull()
    expect(goal.createdAt).toBe(NOW.getTime())

    const updated = await goalRepo.update(goal.id, { title: 'Master DSA' })
    expect(updated.title).toBe('Master DSA')
    expect(updated.id).toBe(goal.id)
    expect(updated.createdAt).toBe(goal.createdAt)
  })

  it('hides a soft-deleted goal from reads and brings it back exactly', async () => {
    const goal = await goalRepo.create(goalInput({ title: 'Ship the app' }))

    await goalRepo.softDelete(goal.id)
    expect(await goalRepo.get(goal.id)).toBeUndefined()
    expect(await goalRepo.listLive()).toHaveLength(0)

    const restored = await goalRepo.restore(goal.id)
    expect(restored.deletedAt).toBeNull()
    expect(restored.title).toBe('Ship the app')
    expect(await goalRepo.listLive()).toHaveLength(1)
  })

  it('keeps status and deletion independent', async () => {
    const goal = await goalRepo.create(goalInput())

    // Archiving is a status change, so the row stays live.
    await goalRepo.update(goal.id, { status: 'dropped' })
    expect(await goalRepo.listLive()).toHaveLength(1)
    expect((await goalRepo.get(goal.id))?.status).toBe('dropped')

    // Deleting hides it without rewriting the status it carried.
    await goalRepo.softDelete(goal.id)
    const hidden = await goalRepo.get(goal.id, { includeDeleted: true })
    expect(hidden?.status).toBe('dropped')
    expect(hidden?.deletedAt).not.toBeNull()
  })

  it('lists in manual order regardless of insertion order', async () => {
    await goalRepo.create(goalInput({ title: 'third', sortOrder: 3000 }))
    await goalRepo.create(goalInput({ title: 'first', sortOrder: 1000 }))
    await goalRepo.create(goalInput({ title: 'second', sortOrder: 2000 }))

    expect((await goalRepo.listLive()).map((g) => g.title)).toEqual(['first', 'second', 'third'])
    expect(await goalRepo.lastOrder()).toBe(3000)
  })

  it('respaces orders without touching anything else', async () => {
    const a = await goalRepo.create(goalInput({ title: 'a', sortOrder: 1000 }))
    const b = await goalRepo.create(goalInput({ title: 'b', sortOrder: 1001 }))

    await goalRepo.respaceOrders([
      { id: a.id, sortOrder: 1000 },
      { id: b.id, sortOrder: 2000 },
    ])

    const rows = await goalRepo.listLive()
    expect(rows.map((g) => g.sortOrder)).toEqual([1000, 2000])
    expect(rows.map((g) => g.title)).toEqual(['a', 'b'])
  })

  it('emits one event per mutation', async () => {
    const goal = await goalRepo.create(goalInput())
    await goalRepo.update(goal.id, { title: 'renamed' })
    await goalRepo.softDelete(goal.id)

    const types = (await db.events.toArray())
      .filter((e) => e.entityId === goal.id)
      .map((e) => e.type)
      .sort()
    expect(types).toEqual(['goal.created', 'goal.deleted', 'goal.updated'])
  })
})

describe('milestones', () => {
  it('reads one goal milestones in manual order, and never another goal', async () => {
    const mine = await goalRepo.create(goalInput({ title: 'mine' }))
    const other = await goalRepo.create(goalInput({ title: 'other' }))

    await milestoneRepo.create(milestoneInput(mine.id, { title: 'B', sortOrder: 2000 }))
    await milestoneRepo.create(milestoneInput(mine.id, { title: 'A', sortOrder: 1000 }))
    await milestoneRepo.create(milestoneInput(other.id, { title: 'theirs' }))

    expect((await milestoneRepo.byGoal(mine.id)).map((m) => m.title)).toEqual(['A', 'B'])
    expect((await milestoneRepo.byGoal(other.id)).map((m) => m.title)).toEqual(['theirs'])
    expect(await milestoneRepo.listLive()).toHaveLength(3)
  })

  it('excludes a soft-deleted milestone and restores it into place', async () => {
    const goal = await goalRepo.create(goalInput())
    const first = await milestoneRepo.create(milestoneInput(goal.id, { title: 'A' }))
    await milestoneRepo.create(milestoneInput(goal.id, { title: 'B', sortOrder: 2000 }))

    await milestoneRepo.softDelete(first.id)
    expect((await milestoneRepo.byGoal(goal.id)).map((m) => m.title)).toEqual(['B'])

    await milestoneRepo.restore(first.id)
    // Back where it was, because restore returns the row unchanged apart from
    // the tombstone — the manual order it carried was never rewritten.
    expect((await milestoneRepo.byGoal(goal.id)).map((m) => m.title)).toEqual(['A', 'B'])
  })

  it('appends after the last milestone of its own goal only', async () => {
    const a = await goalRepo.create(goalInput({ title: 'a' }))
    const b = await goalRepo.create(goalInput({ title: 'b' }))

    await milestoneRepo.create(milestoneInput(a.id, { sortOrder: 5000 }))
    await milestoneRepo.create(milestoneInput(b.id, { sortOrder: 1000 }))

    expect(await milestoneRepo.lastOrder(a.id)).toBe(5000)
    expect(await milestoneRepo.lastOrder(b.id)).toBe(1000)
  })

  it('has no last order for a goal with no milestones', async () => {
    const goal = await goalRepo.create(goalInput())
    expect(await milestoneRepo.lastOrder(goal.id)).toBeUndefined()
    expect(await milestoneRepo.byGoal(goal.id)).toEqual([])
  })

  it('finds the live tasks pointing at a milestone', async () => {
    const goal = await goalRepo.create(goalInput())
    const milestone = await milestoneRepo.create(milestoneInput(goal.id))
    const other = await milestoneRepo.create(milestoneInput(goal.id, { title: 'Graphs' }))

    await taskRepo.create(taskInput({ title: 'one', milestoneId: milestone.id }))
    const gone = await taskRepo.create(taskInput({ title: 'two', milestoneId: milestone.id }))
    await taskRepo.create(taskInput({ title: 'elsewhere', milestoneId: other.id }))
    await taskRepo.create(taskInput({ title: 'loose' }))

    expect(await milestoneRepo.countTasks(milestone.id)).toBe(2)

    // A deleted task is not work that still belongs to the checkpoint.
    await taskRepo.softDelete(gone.id)
    expect((await milestoneRepo.tasksFor(milestone.id)).map((t) => t.title)).toEqual(['one'])
    expect(await milestoneRepo.countTasks(milestone.id)).toBe(1)
  })

  it('reports no tasks for a milestone nothing points at', async () => {
    const goal = await goalRepo.create(goalInput())
    const milestone = await milestoneRepo.create(milestoneInput(goal.id))
    expect(await milestoneRepo.tasksFor(milestone.id)).toEqual([])
    expect(await milestoneRepo.countTasks(milestone.id)).toBe(0)
  })

  it('emits milestone events under its own entity type', async () => {
    const goal = await goalRepo.create(goalInput())
    const milestone = await milestoneRepo.create(milestoneInput(goal.id))
    await milestoneRepo.update(milestone.id, { done: true })

    const events = (await db.events.toArray()).filter((e) => e.entityId === milestone.id)
    expect(events.map((e) => e.type).sort()).toEqual(['milestone.created', 'milestone.updated'])
    expect(events.every((e) => e.entityType === 'milestone')).toBe(true)
  })
})
