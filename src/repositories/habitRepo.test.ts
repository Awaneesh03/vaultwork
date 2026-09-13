import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { habitEntryRepo, habitRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../tests/helpers'

/**
 * The habit stores, against a real IndexedDB.
 *
 * The load-bearing property is the unique `[habitId+date]` index: two rows for
 * one habit on one day must be impossible at the *database* level, not merely
 * unlikely because the UI guards against it.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const habitInput = (overrides: Record<string, unknown> = {}) => ({
  name: 'Read',
  color: 'teal',
  cadence: 'daily' as const,
  daysOfWeek: [] as number[],
  targetPerWeek: null,
  kind: 'binary' as const,
  unit: null,
  target: null,
  sortOrder: 1000,
  archivedAt: null,
  ...overrides,
})

describe('habit CRUD', () => {
  it('creates, reads and updates in place', async () => {
    const habit = await habitRepo.create(habitInput())
    expect(habit.deletedAt).toBeNull()

    const updated = await habitRepo.update(habit.id, { name: 'Read more' })
    expect(updated.id).toBe(habit.id)
    expect(await habitRepo.count()).toBe(1)
  })

  it('soft-deletes and restores', async () => {
    const habit = await habitRepo.create(habitInput())
    await habitRepo.softDelete(habit.id)

    expect(await habitRepo.get(habit.id)).toBeUndefined()
    expect(await db.habits.count()).toBe(1)
    expect((await habitRepo.restore(habit.id)).deletedAt).toBeNull()
  })

  it('separates archived from active without deleting anything', async () => {
    await habitRepo.create(habitInput({ name: 'Active' }))
    await habitRepo.create(habitInput({ name: 'Old', archivedAt: 123, sortOrder: 2000 }))

    expect((await habitRepo.listActive()).map((row) => row.name)).toEqual(['Active'])
    expect((await habitRepo.listArchived()).map((row) => row.name)).toEqual(['Old'])
    expect(await habitRepo.listLive()).toHaveLength(2)
  })

  it('lists in sortOrder and reports the last one', async () => {
    await habitRepo.create(habitInput({ name: 'third', sortOrder: 3000 }))
    await habitRepo.create(habitInput({ name: 'first', sortOrder: 1000 }))

    expect((await habitRepo.listLive()).map((row) => row.name)).toEqual(['first', 'third'])
    expect(await habitRepo.lastOrder()).toBe(3000)
  })

  it('respaces a whole list in one transaction', async () => {
    const a = await habitRepo.create(habitInput({ name: 'a', sortOrder: 1000 }))
    const b = await habitRepo.create(habitInput({ name: 'b', sortOrder: 1000.0001 }))

    await habitRepo.respaceOrders([
      { id: a.id, sortOrder: 1000 },
      { id: b.id, sortOrder: 2000 },
    ])
    expect((await habitRepo.listLive()).map((row) => row.sortOrder)).toEqual([1000, 2000])
  })
})

describe('habit entries', () => {
  it('records a day once, and updates rather than duplicating', async () => {
    const habit = await habitRepo.create(habitInput())

    const first = await habitEntryRepo.logOnce(habit.id, TODAY, 1, null, 1)
    expect(first.created).toBe(true)

    const second = await habitEntryRepo.logOnce(habit.id, TODAY, 1, null, 2)
    expect(second.created).toBe(false)
    expect(second.changed).toBe(false)
    expect(await db.habitEntries.count()).toBe(1)
  })

  it('reports a changed value as a change, still on one row', async () => {
    const habit = await habitRepo.create(habitInput())
    await habitEntryRepo.logOnce(habit.id, TODAY, 30, null, 1)
    const updated = await habitEntryRepo.logOnce(habit.id, TODAY, 90, null, 2)

    expect(updated.changed).toBe(true)
    expect(updated.entry.value).toBe(90)
    expect(await db.habitEntries.count()).toBe(1)
  })

  it('cannot be raced into two rows', async () => {
    const habit = await habitRepo.create(habitInput())
    await Promise.all([
      habitEntryRepo.logOnce(habit.id, TODAY, 1, null, 1),
      habitEntryRepo.logOnce(habit.id, TODAY, 1, null, 2),
      habitEntryRepo.logOnce(habit.id, TODAY, 1, null, 3),
    ])
    expect(await db.habitEntries.count()).toBe(1)
  })

  it('clears a day outright, leaving no tombstone on the unique index', async () => {
    const habit = await habitRepo.create(habitInput())
    await habitEntryRepo.logOnce(habit.id, TODAY, 1, null, 1)

    expect(await habitEntryRepo.clear(habit.id, TODAY)).toBe(true)
    expect(await db.habitEntries.count()).toBe(0)

    // The day can be recorded again, which a soft delete would have prevented.
    const again = await habitEntryRepo.logOnce(habit.id, TODAY, 1, null, 2)
    expect(again.created).toBe(true)
  })

  it('says so when there was nothing to clear', async () => {
    const habit = await habitRepo.create(habitInput())
    expect(await habitEntryRepo.clear(habit.id, TODAY)).toBe(false)
  })

  it('reads a date range across every habit in one query', async () => {
    const a = await habitRepo.create(habitInput({ name: 'A' }))
    const b = await habitRepo.create(habitInput({ name: 'B', sortOrder: 2000 }))

    await habitEntryRepo.logOnce(a.id, '2026-09-01', 1, null, 1)
    await habitEntryRepo.logOnce(b.id, '2026-09-02', 1, null, 2)
    await habitEntryRepo.logOnce(a.id, '2026-08-01', 1, null, 3)

    const rows = await habitEntryRepo.inRange('2026-09-01', '2026-09-30')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.date).sort()).toEqual(['2026-09-01', '2026-09-02'])
  })

  it('narrows a range to one habit, oldest first', async () => {
    const a = await habitRepo.create(habitInput({ name: 'A' }))
    const b = await habitRepo.create(habitInput({ name: 'B', sortOrder: 2000 }))
    await habitEntryRepo.logOnce(a.id, '2026-09-02', 1, null, 1)
    await habitEntryRepo.logOnce(a.id, '2026-09-01', 1, null, 2)
    await habitEntryRepo.logOnce(b.id, '2026-09-01', 1, null, 3)

    const rows = await habitEntryRepo.forHabitInRange(a.id, '2026-09-01', '2026-09-30')
    expect(rows.map((row) => row.date)).toEqual(['2026-09-01', '2026-09-02'])
  })

  it('counts what a habit holds', async () => {
    const habit = await habitRepo.create(habitInput())
    await habitEntryRepo.logOnce(habit.id, '2026-09-01', 1, null, 1)
    await habitEntryRepo.logOnce(habit.id, '2026-09-02', 1, null, 2)
    expect(await habitEntryRepo.countForHabit(habit.id)).toBe(2)
  })

  it('finds one day, and ignores a deleted row', async () => {
    const habit = await habitRepo.create(habitInput())
    const { entry } = await habitEntryRepo.logOnce(habit.id, TODAY, 1, null, 1)
    expect(await habitEntryRepo.forHabitOnDate(habit.id, TODAY)).toBeDefined()

    await db.habitEntries.put({ ...entry, deletedAt: 99 })
    expect(await habitEntryRepo.forHabitOnDate(habit.id, TODAY)).toBeUndefined()
  })
})
