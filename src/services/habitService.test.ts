import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db'
import { addDays, toDateStr, toInstant } from '@/lib/date'
import { platform } from '@/platform'
import { eventRepo, habitEntryRepo, habitRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import {
  EmptyHabitNameError,
  HabitNotScheduledError,
  archiveHabit,
  completeHabit,
  createHabit,
  deleteHabit,
  listActiveHabits,
  listArchivedHabits,
  listHabits,
  moveHabit,
  restoreHabit,
  toggleHabit,
  unarchiveHabit,
  uncompleteHabit,
  updateHabit,
} from './habitService'
import { WEEKDAYS } from './habits/habitSchedule'

/**
 * Habit mutations against a real database.
 *
 * Two properties carry most of the weight here: nothing is ever created for a
 * future date, and history is never rewritten by a configuration change. Both
 * are asserted directly rather than assumed.
 */

// Thursday 3 September 2026, ten in the morning.
const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const eventTypes = async () => (await eventRepo.list()).reverse().map((event) => event.type)

describe('create', () => {
  it('applies the documented defaults', async () => {
    const habit = await createHabit('Read 20 pages')

    expect(habit).toMatchObject({
      name: 'Read 20 pages',
      color: 'teal',
      cadence: 'daily',
      daysOfWeek: [],
      targetPerWeek: null,
      kind: 'binary',
      archivedAt: null,
      deletedAt: null,
    })
  })

  it('writes exactly one row — no future occurrences are materialised', async () => {
    await createHabit('Read 20 pages')

    expect(await db.habits.count()).toBe(1)
    // The whole point: a daily habit is one row, not 365.
    expect(await db.habitEntries.count()).toBe(0)
  })

  it('stores a weekdays schedule as numbers, sorted', async () => {
    const habit = await createHabit('Exercise', { daysOfWeek: [5, 1, 3, 2, 4] })
    expect(habit.daysOfWeek).toEqual(WEEKDAYS)
  })

  it('keeps a weekly habit from also carrying weekdays', async () => {
    const habit = await createHabit('Long run', {
      cadence: 'weekly',
      targetPerWeek: 3,
      daysOfWeek: [1, 2],
    })
    // Two contradictory schedules on one row would be unanswerable.
    expect(habit.daysOfWeek).toEqual([])
    expect(habit.targetPerWeek).toBe(3)
  })

  it('refuses a blank name and trims the rest', async () => {
    await expect(createHabit('   ')).rejects.toThrow(EmptyHabitNameError)
    expect((await createHabit('  Read   20 pages ')).name).toBe('Read 20 pages')
  })

  it('allows two habits with the same name', async () => {
    await createHabit('Walk')
    await createHabit('Walk')
    expect(await listHabits()).toHaveLength(2)
  })

  it('appends after the last habit', async () => {
    const first = await createHabit('A')
    const second = await createHabit('B')
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
  })

  it('emits exactly one habit.created', async () => {
    await createHabit('Read')
    expect(await eventTypes()).toEqual(['habit.created'])
  })
})

describe('completion', () => {
  it('records today, in local time, from the clock port', async () => {
    const habit = await createHabit('Read')
    const { entry } = await completeHabit(habit.id)

    expect(entry.date).toBe(TODAY)
    expect(entry.value).toBe(1)
    expect(await db.habitEntries.count()).toBe(1)
  })

  it('records the local day at 23:59, not the next one', async () => {
    vi.restoreAllMocks()
    freezeClock(new Date(2026, 8, 3, 23, 59, 0))
    const habit = await createHabit('Read')
    expect((await completeHabit(habit.id)).entry.date).toBe(TODAY)
  })

  it('records the new day at 00:01', async () => {
    vi.restoreAllMocks()
    freezeClock(new Date(2026, 8, 4, 0, 1, 0))
    const habit = await createHabit('Read')
    expect((await completeHabit(habit.id)).entry.date).toBe('2026-09-04')
  })

  it('is idempotent: a second completion adds no row and no event', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)
    const second = await completeHabit(habit.id)

    expect(second.changed).toBe(false)
    expect(await db.habitEntries.count()).toBe(1)
    expect(await eventTypes()).toEqual(['habit.created', 'habit.completed'])
  })

  it('cannot create two rows for one habit on one day, even racing', async () => {
    const habit = await createHabit('Read')
    // The unique [habitId+date] index is what makes this safe, not the UI.
    await Promise.all([
      completeHabit(habit.id),
      completeHabit(habit.id),
      completeHabit(habit.id),
    ])
    expect(await db.habitEntries.count()).toBe(1)
  })

  it('refuses a day the habit is not scheduled on', async () => {
    const weekdays = await createHabit('Exercise', { daysOfWeek: WEEKDAYS })
    // 5 September 2026 is a Saturday.
    await expect(
      completeHabit(weekdays.id, { date: '2026-09-05' }),
    ).rejects.toThrow(HabitNotScheduledError)
  })

  it('logs a quantity habit at its target by default', async () => {
    const habit = await createHabit('Study', { kind: 'quantity', unit: 'minutes', target: 90 })
    expect((await completeHabit(habit.id)).entry.value).toBe(90)
  })

  it('accepts an explicit value for a quantity habit', async () => {
    const habit = await createHabit('Study', { kind: 'quantity', unit: 'minutes', target: 90 })
    const { entry } = await completeHabit(habit.id, { value: 30 })
    expect(entry.value).toBe(30)
  })

  it('emits one habit.completed carrying the date it recorded', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)

    const [event] = await eventRepo.list({ type: 'habit.completed' })
    expect(event?.payload).toMatchObject({ name: 'Read', date: TODAY, value: 1 })
    expect(event?.entityId).toBe(habit.id)
  })
})

describe('uncompleting', () => {
  it('removes the row so the day reads as not done', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)

    expect(await uncompleteHabit(habit.id)).toBe(true)
    expect(await db.habitEntries.count()).toBe(0)
    expect(await habitEntryRepo.forHabitOnDate(habit.id, TODAY)).toBeUndefined()
  })

  it('leaves no tombstone occupying the unique index', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)
    await uncompleteHabit(habit.id)

    // A soft-deleted row would sit on [habitId+date] and block this forever.
    const again = await completeHabit(habit.id)
    expect(again.changed).toBe(true)
    expect(await db.habitEntries.count()).toBe(1)
  })

  it('does nothing, and says so, when there was no entry', async () => {
    const habit = await createHabit('Read')
    expect(await uncompleteHabit(habit.id)).toBe(false)
    expect(await eventTypes()).toEqual(['habit.created'])
  })

  it('emits exactly one habit.uncompleted', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)
    await uncompleteHabit(habit.id)

    expect(await eventTypes()).toEqual([
      'habit.created',
      'habit.completed',
      'habit.uncompleted',
    ])
  })

  it('toggles both ways', async () => {
    const habit = await createHabit('Read')
    expect(await toggleHabit(habit.id)).toBe(true)
    expect(await db.habitEntries.count()).toBe(1)
    expect(await toggleHabit(habit.id)).toBe(false)
    expect(await db.habitEntries.count()).toBe(0)
  })

  it('treats an under-target quantity log as still incomplete when toggled', async () => {
    const habit = await createHabit('Study', { kind: 'quantity', target: 90 })
    await completeHabit(habit.id, { value: 30 })
    // 30 of 90 is not done, so toggling completes it rather than clearing it.
    expect(await toggleHabit(habit.id)).toBe(true)
    expect((await habitEntryRepo.forHabitOnDate(habit.id, TODAY))?.value).toBe(90)
  })
})

describe('editing never rewrites history', () => {
  /** Three completed days, then the habit is reconfigured. */
  const withHistory = async () => {
    const habit = await createHabit('Read')
    for (const date of [addDays(TODAY, -2), addDays(TODAY, -1), TODAY]) {
      await completeHabit(habit.id, { date })
    }
    return habit
  }

  it('leaves entries untouched when the schedule changes', async () => {
    const habit = await withHistory()
    const before = await habitEntryRepo.forHabit(habit.id)

    await updateHabit(habit.id, { daysOfWeek: WEEKDAYS })

    const after = await habitEntryRepo.forHabit(habit.id)
    expect(after).toEqual(before)
    expect(after).toHaveLength(3)
  })

  it('leaves entries untouched when the name changes', async () => {
    const habit = await withHistory()
    const before = await habitEntryRepo.forHabit(habit.id)

    await updateHabit(habit.id, { name: 'Read 30 pages' })

    expect(await habitEntryRepo.forHabit(habit.id)).toEqual(before)
  })

  it('leaves entries untouched when the colour changes', async () => {
    const habit = await withHistory()
    const before = await habitEntryRepo.forHabit(habit.id)
    await updateHabit(habit.id, { color: 'violet' })
    expect(await habitEntryRepo.forHabit(habit.id)).toEqual(before)
  })

  it('keeps the id, so an edit cannot fork a habit', async () => {
    const habit = await createHabit('Read')
    const updated = await updateHabit(habit.id, { name: 'Read more' })

    expect(updated.id).toBe(habit.id)
    expect(await listHabits()).toHaveLength(1)
  })

  it('writes nothing when the patch changes nothing', async () => {
    const habit = await createHabit('Read')
    const same = await updateHabit(habit.id, { name: 'Read', color: 'teal' })

    expect(same.updatedAt).toBe(habit.updatedAt)
    expect(await eventTypes()).toEqual(['habit.created'])
  })

  it('clears the weekly target when moving back to a daily cadence', async () => {
    const habit = await createHabit('Run', { cadence: 'weekly', targetPerWeek: 3 })
    const daily = await updateHabit(habit.id, { cadence: 'daily', daysOfWeek: [1, 3] })

    expect(daily.targetPerWeek).toBeNull()
    expect(daily.daysOfWeek).toEqual([1, 3])
  })
})

describe('archive', () => {
  it('hides the habit from the active list but keeps it live', async () => {
    const habit = await createHabit('Read')
    await archiveHabit(habit.id)

    expect(await listActiveHabits()).toEqual([])
    expect((await listArchivedHabits()).map((row) => row.name)).toEqual(['Read'])
    expect(await listHabits()).toHaveLength(1)
  })

  it('keeps every entry', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)
    await archiveHabit(habit.id)

    expect(await habitEntryRepo.forHabit(habit.id)).toHaveLength(1)
    expect(await db.habitEntries.count()).toBe(1)
  })

  it('emits one habit.archived reporting what it kept', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)
    await archiveHabit(habit.id)

    const [event] = await eventRepo.list({ type: 'habit.archived' })
    expect(event?.payload).toMatchObject({ name: 'Read', entryCount: 1 })
    expect(await eventTypes()).toEqual([
      'habit.created',
      'habit.completed',
      'habit.archived',
    ])
  })

  it('is idempotent', async () => {
    const habit = await createHabit('Read')
    await archiveHabit(habit.id)
    await archiveHabit(habit.id)
    expect(await eventTypes()).toEqual(['habit.created', 'habit.archived'])
  })

  it('comes back with its history on unarchive', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)
    await archiveHabit(habit.id)

    const restored = await unarchiveHabit(habit.id)
    expect(restored.archivedAt).toBeNull()
    expect(await habitEntryRepo.forHabit(habit.id)).toHaveLength(1)
    expect(await eventTypes()).toContain('habit.restored')
  })
})

describe('delete', () => {
  it('soft-deletes and retains every entry', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id, { date: addDays(TODAY, -1) })
    await completeHabit(habit.id)

    const deletion = await deleteHabit(habit.id)

    expect(deletion.retainedEntryCount).toBe(2)
    expect(await listHabits()).toEqual([])
    // The history is still there — deletion is undoable precisely because of it.
    expect(await db.habitEntries.count()).toBe(2)
  })

  it('restores the habit with its history intact', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)
    await deleteHabit(habit.id)

    const restored = await restoreHabit(habit.id)
    expect(restored.deletedAt).toBeNull()
    expect(await habitEntryRepo.forHabit(habit.id)).toHaveLength(1)
  })

  it('emits habit.deleted then habit.restored', async () => {
    const habit = await createHabit('Read')
    await deleteHabit(habit.id)
    await restoreHabit(habit.id)

    expect(await eventTypes()).toEqual([
      'habit.created',
      'habit.deleted',
      'habit.restored',
    ])
  })
})

describe('ordering', () => {
  it('writes one row and emits one habit.reordered', async () => {
    const a = await createHabit('A')
    const b = await createHabit('B')
    const c = await createHabit('C')

    const moved = await moveHabit([a.id, b.id, c.id], 2, 0)

    expect(moved?.id).toBe(c.id)
    expect((await listHabits()).map((row) => row.name)).toEqual(['C', 'A', 'B'])
    expect(await eventTypes()).toEqual([
      'habit.created',
      'habit.created',
      'habit.created',
      'habit.reordered',
    ])
  })

  it('persists the order across a fresh read', async () => {
    const a = await createHabit('A')
    const b = await createHabit('B')
    await moveHabit([a.id, b.id], 1, 0)

    expect((await habitRepo.listLive()).map((row) => row.name)).toEqual(['B', 'A'])
  })

  it('does nothing when the indices match', async () => {
    const a = await createHabit('A')
    const b = await createHabit('B')
    expect(await moveHabit([a.id, b.id], 1, 1)).toBeUndefined()
  })

  it('respaces rather than colliding when midpoints run out', async () => {
    const a = await createHabit('A', { sortOrder: 1000 })
    const b = await createHabit('B', { sortOrder: 1000.0000001 })
    const c = await createHabit('C', { sortOrder: 1000.0000002 })

    await moveHabit([a.id, b.id, c.id], 2, 1)

    const rows = await listHabits()
    expect(new Set(rows.map((row) => row.sortOrder)).size).toBe(3)
    expect(rows.map((row) => row.name)).toEqual(['A', 'C', 'B'])
  })
})

describe('the clock port is the only source of "today"', () => {
  it('follows a pinned clock rather than the wall clock', async () => {
    const habit = await createHabit('Read')
    vi.spyOn(platform.clock, 'today').mockReturnValue('2027-01-01')

    expect((await completeHabit(habit.id)).entry.date).toBe('2027-01-01')
    // And the real local date is not what was written.
    expect(toDateStr(new Date(toInstant(TODAY, '10:00')))).toBe(TODAY)
  })
})
