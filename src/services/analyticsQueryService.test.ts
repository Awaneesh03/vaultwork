import { beforeEach, describe, expect, it } from 'vitest'
import { eventRepo, focusSessionRepo } from '@/repositories'
import type { EventSource, FocusKind } from '@/types/enums'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { getAnalytics, type AnalyticsData } from './analyticsQueryService'

/**
 * Analytics, counted from the event log.
 *
 * There is no analytics table to seed, so every test here plants *history* —
 * events at exact instants and focus sessions with real end times — and then
 * asks what the log says. That is the property worth protecting: these numbers
 * are a function of what happened, so a figure can only be wrong if the history
 * is, and nothing needs to be kept in step by hand.
 *
 * Days are the user's local days throughout, which is why several tests plant
 * things late at night: bucketing on UTC would quietly move an eleven-o'clock
 * task into tomorrow for most of the world.
 */

// Thursday 3 September 2026, ten in the morning.
const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'
const YESTERDAY = '2026-09-02'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

/** An event at a precise local instant, bypassing the clock entirely. */
const plant = (
  type: string,
  at: Date,
  { source = 'ui' as EventSource, entityType = 'task' } = {},
) => eventRepo.append({ type, entityType, entityId: 'x', source, at: at.getTime() })

/** A finished focus session of a given length, ending when it ended. */
const plantFocus = (endedAt: Date, actualMin: number, kind: FocusKind = 'work') =>
  focusSessionRepo.create(
    {
      taskId: null,
      projectId: null,
      kind,
      startedAt: endedAt.getTime() - actualMin * 60_000,
      endedAt: endedAt.getTime(),
      plannedMin: 25,
      actualMin,
      outcome: 'completed',
    },
    // The repository would otherwise log a `focusSession.created` row *now*,
    // which would land in the window and quietly change the event counts these
    // tests assert on.
    { emit: false },
  )

const dayOf = (data: AnalyticsData, date: string) => data.days.find((day) => day.date === date)

describe('an empty history', () => {
  it('says so rather than drawing a confident flat line', async () => {
    const data = await getAnalytics(7)

    expect(data.empty).toBe(true)
    expect(data.busiestHour).toBeNull()
    expect(data.totals).toMatchObject({
      tasksCompleted: 0,
      tasksCreated: 0,
      habitsCompleted: 0,
      notesTouched: 0,
      focusMinutes: 0,
      focusSessions: 0,
      events: 0,
    })
  })

  it('still returns every day in the range, so a quiet week is not a short one', async () => {
    const data = await getAnalytics(7)

    expect(data.days).toHaveLength(7)
    expect(data.days.map((day) => day.date)).toEqual([
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ])
    expect(data.from).toBe('2026-08-28')
    expect(data.to).toBe(TODAY)
    expect(data.days.every((day) => day.tasksCompleted === 0)).toBe(true)
  })
})

describe('task events', () => {
  it('counts completions and creations on the day they happened', async () => {
    await plant('task.completed', new Date(2026, 8, 3, 9, 0))
    await plant('task.completed', new Date(2026, 8, 3, 9, 30))
    await plant('task.completed', new Date(2026, 8, 2, 15, 0))
    await plant('task.created', new Date(2026, 8, 3, 8, 0))

    const data = await getAnalytics(7)

    expect(data.empty).toBe(false)
    expect(dayOf(data, TODAY)).toMatchObject({ tasksCompleted: 2, tasksCreated: 1 })
    expect(dayOf(data, YESTERDAY)).toMatchObject({ tasksCompleted: 1, tasksCreated: 0 })
    expect(data.totals).toMatchObject({ tasksCompleted: 3, tasksCreated: 1 })
  })

  it('ignores task events that are not productivity', async () => {
    // Named types, not a `task.` prefix rule — reordering a list is not work
    // done, and a prefix match would silently count it.
    await plant('task.reordered', new Date(2026, 8, 3, 9, 0))
    await plant('task.updated', new Date(2026, 8, 3, 9, 5))
    await plant('task.completed', new Date(2026, 8, 3, 9, 10))

    const data = await getAnalytics(7)

    expect(data.totals.tasksCompleted).toBe(1)
    // They are still history, and still counted as activity.
    expect(data.totals.events).toBe(3)
  })

  it('buckets the edges of a local day on that day, not on the UTC one', async () => {
    /*
     * Both ends deliberately. The suite pins TZ=Asia/Kolkata (+05:30), so a
     * UTC-based implementation moves the early-morning one back a day while
     * leaving the late-night one alone; asserting on both means the test fails
     * for any offset rather than only for negative ones.
     */
    await plant('task.completed', new Date(2026, 8, 2, 23, 45))
    await plant('task.completed', new Date(2026, 8, 3, 0, 30))
    await plant('task.completed', new Date(2026, 8, 3, 1, 15))

    const data = await getAnalytics(7)

    expect(dayOf(data, YESTERDAY)?.tasksCompleted).toBe(1)
    expect(dayOf(data, TODAY)?.tasksCompleted).toBe(2)
  })
})

describe('habit events', () => {
  it('counts check-ins per day', async () => {
    await plant('habit.completed', new Date(2026, 8, 1, 7, 0), { entityType: 'habit' })
    await plant('habit.completed', new Date(2026, 8, 2, 7, 0), { entityType: 'habit' })
    await plant('habit.completed', new Date(2026, 8, 2, 21, 0), { entityType: 'habit' })
    await plant('habit.uncompleted', new Date(2026, 8, 2, 21, 5), { entityType: 'habit' })

    const data = await getAnalytics(7)

    expect(dayOf(data, '2026-09-01')?.habitsCompleted).toBe(1)
    expect(dayOf(data, YESTERDAY)?.habitsCompleted).toBe(2)
    expect(data.totals.habitsCompleted).toBe(3)
  })
})

describe('note events', () => {
  it('counts writing, editing and importing alike', async () => {
    await plant('note.created', new Date(2026, 8, 3, 9, 0), { entityType: 'note' })
    await plant('note.updated', new Date(2026, 8, 3, 9, 5), { entityType: 'note' })
    await plant('note.imported', new Date(2026, 8, 3, 9, 6), { entityType: 'note' })
    await plant('note.deleted', new Date(2026, 8, 3, 9, 7), { entityType: 'note' })

    const data = await getAnalytics(7)

    expect(dayOf(data, TODAY)?.notesTouched).toBe(3)
  })
})

describe('focus sessions', () => {
  it('takes the minutes from the session, not from its event', async () => {
    // A session stopped at minute twelve contributes twelve, even though it
    // planned twenty-five. The row that owns the duration is the authority.
    await plantFocus(new Date(2026, 8, 3, 9, 12), 12)
    await plantFocus(new Date(2026, 8, 3, 9, 50), 25)
    await plantFocus(new Date(2026, 8, 2, 16, 0), 25)

    const data = await getAnalytics(7)

    expect(dayOf(data, TODAY)?.focusMinutes).toBe(37)
    expect(dayOf(data, YESTERDAY)?.focusMinutes).toBe(25)
    expect(data.totals).toMatchObject({ focusMinutes: 62, focusSessions: 3 })
  })

  it('leaves a running session out until it ends', async () => {
    await focusSessionRepo.create(
      {
        taskId: null,
        projectId: null,
        kind: 'work',
        startedAt: NOW.getTime() - 5 * 60_000,
        endedAt: null,
        plannedMin: 25,
        actualMin: 0,
        outcome: 'completed',
      },
      { emit: false },
    )

    const data = await getAnalytics(7)

    expect(data.totals).toMatchObject({ focusMinutes: 0, focusSessions: 0 })
  })

  it('makes the range non-empty on its own, with no events at all', async () => {
    await plantFocus(new Date(2026, 8, 3, 9, 30), 25)

    const data = await getAnalytics(7)

    expect(data.totals.events).toBe(0)
    expect(data.empty).toBe(false)
  })
})

describe('the range', () => {
  it('excludes history older than the window and includes it in a longer one', async () => {
    await plant('task.completed', new Date(2026, 7, 20, 10, 0)) // 14 days back
    await plant('task.completed', new Date(2026, 8, 3, 10, 0))

    const week = await getAnalytics(7)
    expect(week.days).toHaveLength(7)
    expect(week.totals.tasksCompleted).toBe(1)

    const month = await getAnalytics(30)
    expect(month.days).toHaveLength(30)
    expect(month.totals.tasksCompleted).toBe(2)
    expect(dayOf(month, '2026-08-20')?.tasksCompleted).toBe(1)

    const quarter = await getAnalytics(90)
    expect(quarter.days).toHaveLength(90)
    expect(quarter.range).toBe(90)
  })

  it('leaves out focus sessions that ended before the window opened', async () => {
    await plantFocus(new Date(2026, 7, 20, 10, 0), 25)

    expect((await getAnalytics(7)).totals).toMatchObject({ focusMinutes: 0, focusSessions: 0 })
    expect((await getAnalytics(30)).totals).toMatchObject({ focusMinutes: 25, focusSessions: 1 })
  })

  it('includes everything done so far today rather than stopping at midnight', async () => {
    // The window ends at *now*, not at a whole-day boundary — today is the day
    // a user most wants to see, and a 24-hour multiple would drop it.
    await plant('task.completed', new Date(2026, 8, 3, 0, 1))
    await plant('task.completed', new Date(2026, 8, 3, 9, 59))

    expect((await getAnalytics(7)).totals.tasksCompleted).toBe(2)
  })

  it('defaults to a week', async () => {
    expect((await getAnalytics()).range).toBe(7)
    expect((await getAnalytics()).days).toHaveLength(7)
  })
})

describe('the busiest hour', () => {
  it('is the local hour with the most activity', async () => {
    await plant('task.completed', new Date(2026, 8, 2, 21, 0))
    await plant('task.created', new Date(2026, 8, 2, 21, 30))
    await plant('note.updated', new Date(2026, 8, 3, 21, 5), { entityType: 'note' })
    await plant('task.completed', new Date(2026, 8, 3, 9, 0))

    expect((await getAnalytics(7)).busiestHour).toBe(21)
  })

  it('is null when nothing happened, rather than a misleading midnight', async () => {
    await plantFocus(new Date(2026, 8, 3, 9, 30), 25)

    expect((await getAnalytics(7)).busiestHour).toBeNull()
  })
})
