import { addDays, toDateStr } from '@/lib/date'
import { platform } from '@/platform'
import { eventRepo, focusSessionRepo } from '@/repositories'
import type { DateStr, Timestamp } from '@/types/entities'

/**
 * What the event log knows.
 *
 * Analytics reads the append-only event store and nothing else — there is no
 * analytics table, no counter kept up to date by hand, and nothing to fall out
 * of step. Every number here is a count of things that actually happened,
 * recomputed from history each time it is asked for. A statistic that can be
 * wrong in a way the events are not is a statistic nobody can trust.
 *
 * Days are *local calendar* days, from `platform.clock`, because "what did I
 * finish on Tuesday" is a question about the user's Tuesday. Bucketing on UTC
 * would quietly move late-evening work into tomorrow for anyone east of
 * Greenwich — which is most people, and certainly this application's author.
 */

export const ANALYTICS_RANGES = [7, 30, 90] as const
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]

/** One local day's totals. Present even when nothing happened. */
export interface AnalyticsDay {
  date: DateStr
  tasksCompleted: number
  tasksCreated: number
  habitsCompleted: number
  notesTouched: number
  focusMinutes: number
}

export interface AnalyticsTotals {
  tasksCompleted: number
  tasksCreated: number
  habitsCompleted: number
  notesTouched: number
  focusMinutes: number
  focusSessions: number
  /** Every event in the window, including kinds not charted. */
  events: number
}

export interface AnalyticsData {
  range: AnalyticsRange
  from: DateStr
  to: DateStr
  days: AnalyticsDay[]
  totals: AnalyticsTotals
  /** The busiest local hour, or null when nothing happened. */
  busiestHour: number | null
  /** True when the window holds no events at all — an honest empty state. */
  empty: boolean
}

/**
 * Which event types feed which figure.
 *
 * Named explicitly rather than matched by prefix: `task.reordered` is a task
 * event and is not productivity, and a prefix rule would quietly count it.
 */
const TASK_COMPLETED = 'task.completed'
const TASK_CREATED = 'task.created'
const HABIT_COMPLETED = 'habit.completed'
const NOTE_TOUCHED = new Set(['note.created', 'note.updated', 'note.imported'])

const emptyDay = (date: DateStr): AnalyticsDay => ({
  date,
  tasksCompleted: 0,
  tasksCreated: 0,
  habitsCompleted: 0,
  notesTouched: 0,
  focusMinutes: 0,
})

/**
 * Every local day in the window, oldest first.
 *
 * Built from the calendar rather than from the data, so a quiet Wednesday is a
 * zero on the chart instead of a missing column — a gap would misread as a
 * shorter week.
 */
function daysIn(range: AnalyticsRange, today: DateStr): DateStr[] {
  const days: DateStr[] = []
  for (let offset = range - 1; offset >= 0; offset -= 1) {
    days.push(addDays(today, -offset))
  }
  return days
}

/** The local calendar day a timestamp falls on. */
const dayOf = (at: Timestamp): DateStr => toDateStr(new Date(at))

export async function getAnalytics(range: AnalyticsRange = 7): Promise<AnalyticsData> {
  const today = platform.clock.today()
  const dates = daysIn(range, today)
  const from = dates[0] ?? today
  const to = today

  /*
   * The window in instants.
   *
   * `from` at local midnight to *now*, rather than a fixed 24-hour multiple —
   * a range that ended at midnight would drop everything done today, which is
   * the day the user most wants to see.
   */
  const since = new Date(`${from}T00:00:00`).getTime()
  const until = platform.clock.now()

  const [events, sessions] = await Promise.all([
    eventRepo.list({ since, until }),
    focusSessionRepo.list(),
  ])

  const byDate = new Map<DateStr, AnalyticsDay>(dates.map((date) => [date, emptyDay(date)]))
  const hours = new Array<number>(24).fill(0)

  for (const event of events) {
    const day = byDate.get(dayOf(event.at))
    // An event can sit inside the instant window but outside the day window at
    // the edges; the calendar is the authority.
    if (day === undefined) continue

    const hour = new Date(event.at).getHours()
    hours[hour] = (hours[hour] ?? 0) + 1

    if (event.type === TASK_COMPLETED) day.tasksCompleted += 1
    else if (event.type === TASK_CREATED) day.tasksCreated += 1
    else if (event.type === HABIT_COMPLETED) day.habitsCompleted += 1
    else if (NOTE_TOUCHED.has(event.type)) day.notesTouched += 1
  }

  /*
   * Focus minutes come from the sessions themselves, not from their events.
   *
   * The event records that a session ended; the session records how long it
   * actually ran. Reading the duration from the row that owns it means a
   * stopped session contributes the time it really took rather than the time
   * it intended to.
   */
  let focusSessions = 0
  for (const session of sessions) {
    if (session.endedAt === null) continue
    const day = byDate.get(dayOf(session.endedAt))
    if (day === undefined) continue
    day.focusMinutes += session.actualMin
    focusSessions += 1
  }

  const days = dates.map((date) => byDate.get(date) ?? emptyDay(date))

  const totals = days.reduce<AnalyticsTotals>(
    (sum, day) => ({
      tasksCompleted: sum.tasksCompleted + day.tasksCompleted,
      tasksCreated: sum.tasksCreated + day.tasksCreated,
      habitsCompleted: sum.habitsCompleted + day.habitsCompleted,
      notesTouched: sum.notesTouched + day.notesTouched,
      focusMinutes: sum.focusMinutes + day.focusMinutes,
      focusSessions,
      events: sum.events,
    }),
    {
      tasksCompleted: 0,
      tasksCreated: 0,
      habitsCompleted: 0,
      notesTouched: 0,
      focusMinutes: 0,
      focusSessions,
      events: events.length,
    },
  )

  const busiest = hours.reduce(
    (best, count, hour) => (count > best.count ? { hour, count } : best),
    { hour: -1, count: 0 },
  )

  return {
    range,
    from,
    to,
    days,
    totals,
    busiestHour: busiest.count === 0 ? null : busiest.hour,
    // "Nothing to show" is about the window, not about the database: a user
    // with years of history and a quiet week should be told the week was quiet.
    empty: events.length === 0 && totals.focusSessions === 0,
  }
}
