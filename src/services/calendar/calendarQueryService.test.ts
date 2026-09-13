import { beforeEach, describe, expect, it } from 'vitest'
import { addDays, toInstant } from '@/lib/date'
import { settingsRepo, taskRepo } from '@/repositories'
import type { Task } from '@/types/entities'
import { freezeClock, resetDatabase } from '../../../tests/helpers'
import { getDashboard } from '../dashboard/dashboardQueryService'
import { createProject } from '../projectService'
import { createTag } from '../tagService'
import { completeTask, createTask, deleteTask, rescheduleTask } from '../taskService'
import { getTaskView } from '../taskQueryService'
import { getCalendar, getTasksOnDate, placementOf } from './calendarQueryService'

/**
 * The calendar view model, against a real database.
 *
 * The load-bearing tests here are the *consistency* ones at the bottom: the
 * calendar must place a task on the same date, call it overdue at the same
 * moment, and consider it complete on the same terms as Today, Upcoming,
 * Overdue and the Dashboard. Those fail the instant the calendar grows an
 * interpretation of its own, which is exactly what M6 must not do.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

const titles = (tasks: Task[]) => tasks.map((task) => task.title)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

describe('task placement', () => {
  it('names the three placements from the task alone', () => {
    const base = { dueDate: null, dueTime: null } as unknown as Task
    expect(placementOf(base)).toBe('unscheduled')
    expect(placementOf({ ...base, dueDate: TODAY } as Task)).toBe('allDay')
    expect(placementOf({ ...base, dueDate: TODAY, dueTime: '19:00' } as Task)).toBe('timed')
  })

  it('puts a dated task on its own date and nowhere else', async () => {
    await createTask({ title: 'Study Java', dueDate: '2026-09-10' })

    const data = await getCalendar({ mode: 'month', anchor: TODAY })
    const holding = data.days.filter((day) => day.tasks.length > 0)

    expect(holding).toHaveLength(1)
    expect(holding[0]?.date).toBe('2026-09-10')
  })

  it('separates all-day from timed work on the same date', async () => {
    await createTask({ title: 'anytime', dueDate: TODAY })
    await createTask({ title: 'evening', dueDate: TODAY, dueTime: '19:00' })

    const day = (await getCalendar({ mode: 'day', anchor: TODAY })).days[0]
    expect(titles(day?.allDay ?? [])).toEqual(['anytime'])
    expect(titles(day?.timed ?? [])).toEqual(['evening'])
    // All-day first, then timed: the order a day cell renders.
    expect(titles(day?.tasks ?? [])).toEqual(['anytime', 'evening'])
  })

  it('orders timed work by the clock', async () => {
    await createTask({ title: 'evening', dueDate: TODAY, dueTime: '19:00' })
    await createTask({ title: 'dawn', dueDate: TODAY, dueTime: '06:30' })
    await createTask({ title: 'noon', dueDate: TODAY, dueTime: '12:00' })

    const day = (await getCalendar({ mode: 'day', anchor: TODAY })).days[0]
    expect(titles(day?.timed ?? [])).toEqual(['dawn', 'noon', 'evening'])
  })

  it('never places an undated task on a date', async () => {
    await createTask({ title: 'someday' })

    const data = await getCalendar({ mode: 'month', anchor: TODAY })
    expect(data.days.every((day) => day.tasks.length === 0)).toBe(true)
    expect(titles(data.unscheduled)).toEqual(['someday'])
    expect(data.unscheduledTotal).toBe(1)
  })

  it('drops a task off the grid when its date is removed', async () => {
    const task = await createTask({ title: 'Study Java', dueDate: TODAY })
    expect((await getTasksOnDate(TODAY))).toHaveLength(1)

    await rescheduleTask(task.id, null)

    expect(await getTasksOnDate(TODAY)).toEqual([])
    const data = await getCalendar({ mode: 'day', anchor: TODAY })
    expect(titles(data.unscheduled)).toEqual(['Study Java'])
  })

  it('excludes deleted tasks entirely', async () => {
    const task = await createTask({ title: 'gone', dueDate: TODAY })
    await deleteTask(task.id)

    const data = await getCalendar({ mode: 'day', anchor: TODAY })
    expect(data.days[0]?.tasks).toEqual([])
    expect(data.counts.total).toBe(0)
  })
})

describe('completed tasks', () => {
  it('keeps them on their date rather than hiding them', async () => {
    const task = await createTask({ title: 'Study Java', dueDate: TODAY })
    await completeTask(task.id)

    const day = (await getCalendar({ mode: 'day', anchor: TODAY })).days[0]
    // A calendar that removed what you finished would misreport the day.
    expect(titles(day?.tasks ?? [])).toEqual(['Study Java'])
    expect(day?.completedCount).toBe(1)
  })

  it('stays on the date it was due, not the date it was finished', async () => {
    const task = await createTask({ title: 'Study Java', dueDate: '2026-09-01' })
    await completeTask(task.id)

    expect(titles(await getTasksOnDate('2026-09-01'))).toEqual(['Study Java'])
    expect(await getTasksOnDate(TODAY)).toEqual([])
  })

  it('can be filtered out, and back in, through the M3 status filter', async () => {
    const done = await createTask({ title: 'finished', dueDate: TODAY })
    await completeTask(done.id)
    await createTask({ title: 'open', dueDate: TODAY })

    expect(titles(await getTasksOnDate(TODAY, 'all')).sort()).toEqual(['finished', 'open'])
    expect(titles(await getTasksOnDate(TODAY, 'todo'))).toEqual(['open'])
    expect(titles(await getTasksOnDate(TODAY, 'done'))).toEqual(['finished'])
  })
})

describe('overdue', () => {
  it('marks a late open task, and not a late finished one', async () => {
    await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })
    const wasLate = await createTask({ title: 'was late', dueDate: addDays(TODAY, -2) })
    await completeTask(wasLate.id)

    const data = await getCalendar({ mode: 'month', anchor: TODAY })
    expect(data.counts.overdue).toBe(1)

    const lateDay = data.days.find((day) => day.date === addDays(TODAY, -1))
    const doneDay = data.days.find((day) => day.date === addDays(TODAY, -2))
    expect(lateDay?.overdueCount).toBe(1)
    expect(doneDay?.overdueCount).toBe(0)
  })

  it('does not call today or the future late', async () => {
    await createTask({ title: 'today', dueDate: TODAY })
    await createTask({ title: 'tomorrow', dueDate: addDays(TODAY, 1) })

    expect((await getCalendar({ mode: 'month', anchor: TODAY })).counts.overdue).toBe(0)
  })
})

describe('the visible period', () => {
  it('reads the padded month grid, adjacent-month days included', async () => {
    // 31 August is in September 2026's Monday-start grid.
    await createTask({ title: 'previous month', dueDate: '2026-08-31' })
    await createTask({ title: 'next month', dueDate: '2026-10-04' })
    await createTask({ title: 'outside', dueDate: '2026-08-30' })

    const data = await getCalendar({ mode: 'month', anchor: TODAY })
    const shown = titles(data.days.flatMap((day) => day.tasks))

    expect(shown).toContain('previous month')
    expect(shown).toContain('next month')
    expect(shown).not.toContain('outside')
  })

  it('marks adjacent-month days as outside the month', async () => {
    const data = await getCalendar({ mode: 'month', anchor: TODAY })
    expect(data.days.find((day) => day.date === '2026-08-31')?.isCurrentMonth).toBe(false)
    expect(data.days.find((day) => day.date === '2026-09-01')?.isCurrentMonth).toBe(true)
  })

  it('marks today, wherever it falls in the grid', async () => {
    const data = await getCalendar({ mode: 'month', anchor: TODAY })
    expect(data.days.filter((day) => day.isToday).map((day) => day.date)).toEqual([TODAY])
  })

  it('still marks today when the anchor is a different month', async () => {
    const data = await getCalendar({ mode: 'month', anchor: '2026-11-15' })
    expect(data.days.some((day) => day.isToday)).toBe(false)
    expect(data.today).toBe(TODAY)
  })

  it('reads exactly the week in week mode', async () => {
    await createTask({ title: 'in week', dueDate: '2026-09-06' })
    await createTask({ title: 'next week', dueDate: '2026-09-07' })

    const data = await getCalendar({ mode: 'week', anchor: TODAY })
    expect(data.weeks).toHaveLength(1)
    expect(data.days).toHaveLength(7)

    const shown = titles(data.days.flatMap((day) => day.tasks))
    expect(shown).toEqual(['in week'])
  })

  it('reads exactly the one day in day mode', async () => {
    await createTask({ title: 'today', dueDate: TODAY })
    await createTask({ title: 'tomorrow', dueDate: addDays(TODAY, 1) })

    const data = await getCalendar({ mode: 'day', anchor: TODAY })
    expect(data.days).toHaveLength(1)
    expect(titles(data.days[0]?.tasks ?? [])).toEqual(['today'])
  })

  it('defaults its anchor to the clock port when none is given', async () => {
    const data = await getCalendar({ mode: 'month' })
    expect(data.anchor).toBe(TODAY)
    expect(data.today).toBe(TODAY)
  })

  it('follows the week-start setting', async () => {
    const monday = await getCalendar({ mode: 'week', anchor: TODAY })
    expect(monday.weekStartsOn).toBe(1)
    expect(monday.days[0]?.date).toBe('2026-08-31')

    await settingsRepo.update({ weekStartsOn: 0 })

    const sunday = await getCalendar({ mode: 'week', anchor: TODAY })
    expect(sunday.weekStartsOn).toBe(0)
    expect(sunday.days[0]?.date).toBe('2026-08-30')
  })
})

describe('local date boundaries', () => {
  it('places a task due on the last day of a month on that day', async () => {
    await createTask({ title: 'month end', dueDate: '2026-08-31' })
    expect(titles(await getTasksOnDate('2026-08-31'))).toEqual(['month end'])
    expect(await getTasksOnDate('2026-09-01')).toEqual([])
  })

  it('places a task on 29 February in a leap year', async () => {
    await createTask({ title: 'leap day', dueDate: '2028-02-29' })

    const data = await getCalendar({ mode: 'month', anchor: '2028-02-15' })
    const day = data.days.find((entry) => entry.date === '2028-02-29')
    expect(titles(day?.tasks ?? [])).toEqual(['leap day'])
  })

  it('places tasks either side of a year boundary on the right days', async () => {
    await createTask({ title: 'new year eve', dueDate: '2026-12-31' })
    await createTask({ title: 'new year day', dueDate: '2027-01-01' })

    expect(titles(await getTasksOnDate('2026-12-31'))).toEqual(['new year eve'])
    expect(titles(await getTasksOnDate('2027-01-01'))).toEqual(['new year day'])
  })

  it('keeps a task completed at 23:59 local on its own due date', async () => {
    const task = await createTask({ title: 'late night', dueDate: TODAY })
    await completeTask(task.id)
    // Back-date the completion instant to one minute before local midnight.
    await taskRepo.update(task.id, { completedAt: toInstant(TODAY, '23:59') }, { emit: false })

    // The due date is what places it; the completion instant never moves it.
    expect(titles(await getTasksOnDate(TODAY))).toEqual(['late night'])
  })

  it('places a task timed at one minute past midnight on that day', async () => {
    await createTask({ title: 'midnight', dueDate: TODAY, dueTime: '00:01' })
    const day = (await getCalendar({ mode: 'day', anchor: TODAY })).days[0]
    expect(titles(day?.timed ?? [])).toEqual(['midnight'])
  })

  it('places a task timed at 23:59 on that day, not the next', async () => {
    await createTask({ title: 'last minute', dueDate: TODAY, dueTime: '23:59' })
    expect(titles(await getTasksOnDate(TODAY))).toEqual(['last minute'])
    expect(await getTasksOnDate(addDays(TODAY, 1))).toEqual([])
  })
})

describe('context and counts', () => {
  it('carries tags, projects and subtask progress for the tasks on screen', async () => {
    const tag = await createTag('java')
    const project = await createProject('College')
    const task = await createTask({
      title: 'Study Java',
      dueDate: TODAY,
      tagIds: [tag.id],
      projectId: project.id,
      subtasks: ['Read', 'Practise'],
    })

    const data = await getCalendar({ mode: 'day', anchor: TODAY })
    expect(data.tags.map((row) => row.name)).toEqual(['java'])
    expect(data.projects.map((row) => row.name)).toEqual(['College'])
    expect(data.progress.get(task.id)).toEqual({ done: 0, total: 2 })
  })

  it('counts what is visible, after the filter', async () => {
    const done = await createTask({ title: 'finished', dueDate: TODAY })
    await completeTask(done.id)
    await createTask({ title: 'open', dueDate: TODAY })
    await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })

    const all = await getCalendar({ mode: 'month', anchor: TODAY })
    expect(all.counts).toEqual({ total: 3, completed: 1, overdue: 1 })

    const open = await getCalendar({ mode: 'month', anchor: TODAY, status: 'todo' })
    expect(open.counts).toEqual({ total: 2, completed: 0, overdue: 1 })
  })

  it('limits how many undated tasks it loads', async () => {
    for (let i = 0; i < 8; i += 1) await createTask({ title: `someday ${i}` })

    const data = await getCalendar({ mode: 'month', anchor: TODAY, unscheduledLimit: 3 })
    expect(data.unscheduled).toHaveLength(3)
    expect(data.unscheduledTotal).toBe(8)
  })
})

describe('cross-view consistency', () => {
  /** The fixture every consistency test below agrees about. */
  const seed = async () => {
    await createTask({ title: 'late', dueDate: addDays(TODAY, -2) })
    await createTask({ title: 'today anytime', dueDate: TODAY })
    await createTask({ title: 'today timed', dueDate: TODAY, dueTime: '19:00' })
    await createTask({ title: 'tomorrow', dueDate: addDays(TODAY, 1) })
    await createTask({ title: 'undated' })
    const done = await createTask({ title: 'finished today', dueDate: TODAY })
    await completeTask(done.id)
  }

  it('agrees with Today about which tasks belong to today', async () => {
    await seed()

    const [calendar, todayView] = await Promise.all([
      getTasksOnDate(TODAY, 'todo'),
      getTaskView('today'),
    ])

    // Today's view also carries the overdue rows it groups at the top, so the
    // comparison is against what it shows *dated today*.
    const todayDated = todayView.tasks.filter((task) => task.dueDate === TODAY)
    expect(titles(calendar).sort()).toEqual(titles(todayDated).sort())
  })

  it('agrees with Overdue about what is late', async () => {
    await seed()

    const [calendar, overdueView] = await Promise.all([
      getCalendar({ mode: 'month', anchor: TODAY }),
      getTaskView('overdue'),
    ])

    expect(calendar.counts.overdue).toBe(overdueView.tasks.length)

    const lateOnCalendar = calendar.days
      .flatMap((day) => day.tasks)
      .filter((task) => task.status === 'todo' && task.dueDate !== null && task.dueDate < TODAY)
    expect(titles(lateOnCalendar).sort()).toEqual(titles(overdueView.tasks).sort())
  })

  it('agrees with Upcoming about the days ahead', async () => {
    await seed()

    const [calendar, upcoming] = await Promise.all([
      getCalendar({ mode: 'month', anchor: TODAY, status: 'todo' }),
      getTaskView('upcoming'),
    ])

    const ahead = calendar.days
      .filter((day) => day.date > TODAY)
      .flatMap((day) => day.tasks)
      .filter((task) => task.dueDate !== null && task.dueDate <= addDays(TODAY, 14))

    expect(titles(ahead).sort()).toEqual(titles(upcoming.tasks).sort())
  })

  it('agrees with the Dashboard about the four figures it reports', async () => {
    await seed()

    const [calendar, dashboard] = await Promise.all([
      getCalendar({ mode: 'month', anchor: TODAY }),
      getDashboard(),
    ])

    expect(calendar.counts.overdue).toBe(dashboard.summary.overdue)

    const dueTodayOnCalendar =
      calendar.days.find((day) => day.date === TODAY)?.tasks.filter((t) => t.status === 'todo')
        .length ?? 0
    expect(dueTodayOnCalendar).toBe(dashboard.summary.dueToday)
  })

  it('agrees with the Inbox about which tasks have no date', async () => {
    await seed()

    const [calendar, inbox] = await Promise.all([
      getCalendar({ mode: 'month', anchor: TODAY, status: 'todo' }),
      getTaskView('inbox'),
    ])

    // Inbox is "no project"; the calendar's unscheduled is "no date". The
    // fixture's one undated task has no project either, so they coincide — and
    // the important half is that it appears on no calendar date at all.
    expect(titles(calendar.unscheduled)).toEqual(['undated'])
    expect(titles(inbox.tasks)).toContain('undated')
    expect(calendar.days.flatMap((day) => titles(day.tasks))).not.toContain('undated')
  })

  it('sees a task created anywhere else, with no calendar-side write', async () => {
    // Created through the ordinary task service, as Inbox or the palette would.
    await createTask({ title: 'from elsewhere', dueDate: '2026-09-10' })
    expect(titles(await getTasksOnDate('2026-09-10'))).toEqual(['from elsewhere'])
  })

  it('follows a task that is rescheduled from anywhere', async () => {
    const task = await createTask({ title: 'moving', dueDate: TODAY })

    await rescheduleTask(task.id, '2026-09-20', '08:30')

    expect(await getTasksOnDate(TODAY)).toEqual([])
    const moved = await getTasksOnDate('2026-09-20')
    expect(titles(moved)).toEqual(['moving'])
    expect(moved[0]?.dueTime).toBe('08:30')
  })
})
