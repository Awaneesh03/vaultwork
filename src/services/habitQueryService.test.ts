import { beforeEach, describe, expect, it } from 'vitest'
import { addDays } from '@/lib/date'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { getDashboard } from './dashboard/dashboardQueryService'
import { getHabitDetail, getHabitsView, getTodayHabits } from './habitQueryService'
import { archiveHabit, completeHabit, createHabit, deleteHabit } from './habitService'
import { WEEKDAYS } from './habits/habitSchedule'
import { createTask } from './taskService'

/**
 * The habit read models, against a real database.
 *
 * The load-bearing tests are at the bottom: the Habits screen and the Dashboard
 * must agree about what is due today and how much of it is done, because they
 * call the same function to find out. Those fail the moment one grows its own
 * copy of the rules.
 */

// Thursday 3 September 2026.
const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const names = (items: { habit: { name: string } }[]) => items.map((item) => item.habit.name)

describe('an empty database', () => {
  it('reports nothing due and divides by nothing', async () => {
    const view = await getHabitsView()
    expect(view.active).toEqual([])
    expect(view.summary).toMatchObject({
      scheduled: 0,
      completed: 0,
      remaining: 0,
      percent: 0,
    })
  })
})

describe('the habits list', () => {
  it('carries schedule, streak and today status for each habit', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id, { date: addDays(TODAY, -1) })
    await completeHabit(habit.id)

    const [item] = (await getHabitsView()).active
    expect(item).toMatchObject({
      frequency: 'daily',
      scheduledToday: true,
      completedToday: true,
      currentStreak: 2,
    })
    expect(item?.history).toHaveLength(30)
  })

  it('shows a weekday habit as unscheduled on a Saturday', async () => {
    await createHabit('Exercise', { daysOfWeek: WEEKDAYS })
    // 5 September 2026 is a Saturday.
    freezeClock(new Date(2026, 8, 5, 10, 0, 0))

    const view = await getHabitsView()
    expect(view.active[0]?.scheduledToday).toBe(false)
    // …and it is therefore not part of today's obligations at all.
    expect(view.summary.scheduled).toBe(0)
  })

  it('separates active from archived and reports both totals', async () => {
    const a = await createHabit('Read')
    await createHabit('Exercise')
    await archiveHabit(a.id)

    const active = await getHabitsView({ state: 'active' })
    expect(names(active.active)).toEqual(['Exercise'])
    expect(active.archived).toEqual([])
    expect(active.activeTotal).toBe(1)
    expect(active.archivedTotal).toBe(1)

    const archived = await getHabitsView({ state: 'archived' })
    expect(names(archived.archived)).toEqual(['Read'])

    const all = await getHabitsView({ state: 'all' })
    expect(all.active).toHaveLength(1)
    expect(all.archived).toHaveLength(1)
  })

  it('never shows a deleted habit', async () => {
    const habit = await createHabit('Read')
    await deleteHabit(habit.id)
    expect((await getHabitsView({ state: 'all' })).active).toEqual([])
  })

  it('searches by name', async () => {
    await createHabit('Read 20 pages')
    await createHabit('Exercise')

    expect(names((await getHabitsView({ search: 'read' })).active)).toEqual(['Read 20 pages'])
    expect(names((await getHabitsView({ search: 'pages read' })).active)).toEqual([
      'Read 20 pages',
    ])
    expect((await getHabitsView({ search: 'nothing' })).active).toEqual([])
  })

  it('filters by frequency', async () => {
    await createHabit('Read')
    await createHabit('Exercise', { daysOfWeek: WEEKDAYS })
    await createHabit('Long run', { cadence: 'weekly', targetPerWeek: 2 })

    expect(names((await getHabitsView({ frequency: 'daily' })).active)).toEqual(['Read'])
    expect(names((await getHabitsView({ frequency: 'weekdays' })).active)).toEqual(['Exercise'])
    expect(names((await getHabitsView({ frequency: 'weekly' })).active)).toEqual(['Long run'])
  })

  it('filters by whether today is done', async () => {
    const read = await createHabit('Read')
    await createHabit('Exercise')
    await completeHabit(read.id)

    expect(names((await getHabitsView({ todayState: 'done' })).active)).toEqual(['Read'])
    expect(names((await getHabitsView({ todayState: 'todo' })).active)).toEqual(['Exercise'])
  })

  it('leaves an unscheduled habit out of the outstanding filter', async () => {
    await createHabit('Exercise', { daysOfWeek: WEEKDAYS })
    freezeClock(new Date(2026, 8, 5, 10, 0, 0))
    // Not due on Saturday, so it is not "still to do" either.
    expect((await getHabitsView({ todayState: 'todo' })).active).toEqual([])
  })

  it('keeps the manual order', async () => {
    await createHabit('A')
    await createHabit('B')
    await createHabit('C')
    expect(names((await getHabitsView()).active)).toEqual(['A', 'B', 'C'])
  })
})

describe("today's summary", () => {
  it('counts only active, scheduled habits', async () => {
    const read = await createHabit('Read')
    await createHabit('Meditate')
    const weekend = await createHabit('Long walk', { daysOfWeek: [0, 6] })
    const archived = await createHabit('Old thing')
    await archiveHabit(archived.id)
    await completeHabit(read.id)

    const summary = await getTodayHabits()
    // Thursday: Read and Meditate are due; the weekend habit and the archived
    // one are not.
    expect(summary).toMatchObject({
      date: TODAY,
      scheduled: 2,
      completed: 1,
      remaining: 1,
      percent: 50,
    })
    expect(summary.habits.map((entry) => entry.name).sort()).toEqual(['Meditate', 'Read'])
    expect(weekend.daysOfWeek).toEqual([0, 6])
  })

  it('moves as habits are completed', async () => {
    const read = await createHabit('Read')
    const meditate = await createHabit('Meditate')

    expect((await getTodayHabits()).completed).toBe(0)
    await completeHabit(read.id)
    expect((await getTodayHabits()).completed).toBe(1)
    await completeHabit(meditate.id)
    expect(await getTodayHabits()).toMatchObject({ completed: 2, remaining: 0, percent: 100 })
  })

  it('reports zero rather than NaN when nothing is due', async () => {
    await createHabit('Weekend walk', { daysOfWeek: [0, 6] })
    expect(await getTodayHabits()).toMatchObject({ scheduled: 0, percent: 0 })
  })
})

describe('habit detail', () => {
  it('returns undefined for a habit that does not exist', async () => {
    expect(await getHabitDetail('nope')).toBeUndefined()
  })

  it('returns undefined for a deleted habit', async () => {
    const habit = await createHabit('Read')
    await deleteHabit(habit.id)
    expect(await getHabitDetail(habit.id)).toBeUndefined()
  })

  it('carries streaks, rate, history and the entries behind them', async () => {
    const habit = await createHabit('Read')
    for (const offset of [-3, -2, -1, 0]) {
      await completeHabit(habit.id, { date: addDays(TODAY, offset) })
    }

    const detail = await getHabitDetail(habit.id)
    expect(detail).toMatchObject({ currentStreak: 4, longestStreak: 4, totalEntries: 4 })
    expect(detail?.entries).toHaveLength(4)
    expect(detail?.history).toHaveLength(30)
    expect(detail?.rate.completed).toBe(4)
  })

  it('is available for an archived habit, with its history', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)
    await archiveHabit(habit.id)

    const detail = await getHabitDetail(habit.id)
    expect(detail?.habit.archivedAt).not.toBeNull()
    expect(detail?.totalEntries).toBe(1)
  })

  it('does not count days before the habit existed as missed', async () => {
    // Created today, so the rate is judged over one day, not thirty.
    const habit = await createHabit('Read')
    await completeHabit(habit.id)

    const detail = await getHabitDetail(habit.id)
    expect(detail?.rate).toEqual({ scheduled: 1, completed: 1, percent: 100 })
  })
})

describe('the Dashboard and the Habits screen agree', () => {
  /** A mixed fixture both screens must describe identically. */
  const seed = async () => {
    const read = await createHabit('Read')
    await createHabit('Meditate')
    await createHabit('Exercise', { daysOfWeek: WEEKDAYS })
    await createHabit('Weekend walk', { daysOfWeek: [0, 6] })
    const archived = await createHabit('Old habit')
    await archiveHabit(archived.id)
    await completeHabit(read.id)
    return read
  }

  it('agrees about which habits are due today', async () => {
    await seed()

    const [view, dashboard] = await Promise.all([getHabitsView(), getDashboard()])

    expect(dashboard.habits).toEqual(view.summary)
    expect(dashboard.habits.habits.map((entry) => entry.name).sort()).toEqual([
      'Exercise',
      'Meditate',
      'Read',
    ])
  })

  it('agrees about the counts, and both move together', async () => {
    await seed()
    expect((await getDashboard()).habits).toMatchObject({ scheduled: 3, completed: 1 })

    const view = await getHabitsView()
    const meditate = view.active.find((item) => item.habit.name === 'Meditate')
    await completeHabit(meditate!.habit.id)

    const [after, afterDashboard] = await Promise.all([getHabitsView(), getDashboard()])
    expect(after.summary).toMatchObject({ scheduled: 3, completed: 2, remaining: 1 })
    expect(afterDashboard.habits).toEqual(after.summary)
  })

  it('excludes archived habits from both', async () => {
    await seed()
    const dashboard = await getDashboard()
    expect(dashboard.habits.habits.map((entry) => entry.name)).not.toContain('Old habit')
  })

  it('keeps the task Next Action task-only', async () => {
    await seed()
    await createTask({ title: 'Study Java', dueDate: TODAY })

    const dashboard = await getDashboard()
    // A habit must never be offered as the next *task*.
    expect(dashboard.nextAction?.title).toBe('Study Java')
    expect(dashboard.habits.scheduled).toBeGreaterThan(0)
  })

  it('leaves Next Action null when only habits exist', async () => {
    await seed()
    const dashboard = await getDashboard()
    expect(dashboard.nextAction).toBeNull()
  })
})
