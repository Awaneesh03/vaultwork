import { addDays, datesBetween, type WeekStart } from '@/lib/date'
import type { DateStr, Habit, HabitEntry } from '@/types/entities'
import {
  isHabitScheduledOn,
  scheduledDatesBetween,
  weekKey,
  weeklyTarget,
} from './habitSchedule'

/**
 * Streaks and completion rates, as pure functions.
 *
 * Every one of them takes the habit, the entries and the dates it needs, and
 * reads nothing else — no clock, no database, no React. That is what makes the
 * awkward cases (a weekday habit over a weekend, a habit created today, a week
 * still in progress) plain assertions instead of things you discover in
 * production three weeks later.
 *
 * The governing rule: **a streak counts scheduled occurrences, not rows.**
 * Counting database rows would make a Monday-to-Friday habit look broken every
 * Saturday, which is exactly backwards — a Saturday was never owed.
 */

/** How far back a calculation will walk. A guard, not a product limit. */
export const MAX_LOOKBACK_DAYS = 366 * 3

/**
 * Did this entry satisfy the habit?
 *
 * Binary habits need any positive value. Quantity habits need to reach their
 * target — the M1 model carries `kind`, `unit` and `target`, and the seed
 * already uses them ("Study, 90 minutes"), so completion has to respect them or
 * a 10-minute session would count the same as a 90-minute one.
 */
export function isEntryComplete(habit: Habit, entry: HabitEntry | undefined): boolean {
  if (!entry || entry.deletedAt !== null) return false
  const required = habit.kind === 'quantity' ? Math.max(1, habit.target ?? 1) : 1
  return entry.value >= required
}

/** Entries keyed by date, newest write winning — the shape every stat wants. */
export function entriesByDate(entries: HabitEntry[]): Map<DateStr, HabitEntry> {
  const map = new Map<DateStr, HabitEntry>()
  for (const entry of entries) {
    if (entry.deletedAt !== null) continue
    map.set(entry.date, entry)
  }
  return map
}

/**
 * Was the habit completed on this date?
 *
 * Named `isCompletedOn` rather than `completedOn` because the dashboard already
 * owns the latter for "which local day was this *task* finished on" — two
 * different questions that would otherwise collide in the service barrel.
 */
export function isCompletedOn(
  habit: Habit,
  byDate: Map<DateStr, HabitEntry>,
  date: DateStr,
): boolean {
  return isEntryComplete(habit, byDate.get(date))
}

// ------------------------------------------------------------------- streaks

export interface StreakOptions {
  /** Where to stop walking back. Normally the day the habit was created. */
  since: DateStr
  weekStartsOn: WeekStart
}

/**
 * The run of completed occurrences ending now.
 *
 * For a **daily-cadence** habit this walks backwards from today over the days
 * the habit is actually scheduled on, counting completions until it meets a
 * scheduled day that was missed. Unscheduled days are skipped entirely — they
 * are neither counted nor treated as a break, which is the whole reason a
 * Monday-to-Friday habit survives a weekend.
 *
 * Today gets one concession: if it is scheduled and *not yet* done, the streak
 * is not broken — it simply does not include today. An unfinished day is "not
 * yet", not "missed", and zeroing someone's streak at midnight for a day they
 * still have hours to complete would be both wrong and unkind.
 *
 * For a **weekly-cadence** habit the unit is the week: it counts consecutive
 * weeks in which the habit was completed at least `targetPerWeek` times, and
 * the current week is likewise excused while it is still in progress.
 */
export function calculateCurrentStreak(
  habit: Habit,
  entries: HabitEntry[],
  today: DateStr,
  options: StreakOptions,
): number {
  const byDate = entriesByDate(entries)

  if (habit.cadence === 'weekly') {
    return currentWeeklyStreak(habit, byDate, today, options)
  }

  let streak = 0
  let cursor = today
  let first = true

  for (let guard = 0; guard < MAX_LOOKBACK_DAYS; guard += 1) {
    if (cursor < options.since) break

    if (isHabitScheduledOn(habit, cursor)) {
      if (isCompletedOn(habit, byDate, cursor)) {
        streak += 1
      } else if (first) {
        // Today, scheduled but not done yet: skip it rather than break.
      } else {
        break
      }
      first = false
    }

    cursor = addDays(cursor, -1)
  }

  return streak
}

function currentWeeklyStreak(
  habit: Habit,
  byDate: Map<DateStr, HabitEntry>,
  today: DateStr,
  options: StreakOptions,
): number {
  const target = weeklyTarget(habit)
  const startWeek = weekKey(options.since, options.weekStartsOn)

  let streak = 0
  let week = weekKey(today, options.weekStartsOn)
  let first = true

  for (let guard = 0; guard < MAX_LOOKBACK_DAYS / 7; guard += 1) {
    if (week < startWeek) break

    const done = datesBetween(week, addDays(week, 6)).filter((date) =>
      isCompletedOn(habit, byDate, date),
    ).length

    if (done >= target) {
      streak += 1
    } else if (first) {
      // The current week is still running; not yet is not a miss.
    } else {
      break
    }

    first = false
    week = addDays(week, -7)
  }

  return streak
}

/**
 * The longest run of completed occurrences inside a range.
 *
 * Explicitly range-bounded, and the caller says how far back to look. A
 * "longest ever" that silently read every entry a habit has would get slower
 * for exactly the people who have used the app longest.
 */
export function calculateLongestStreak(
  habit: Habit,
  entries: HabitEntry[],
  from: DateStr,
  to: DateStr,
  weekStartsOn: WeekStart = 1,
): number {
  const byDate = entriesByDate(entries)

  if (habit.cadence === 'weekly') {
    const target = weeklyTarget(habit)
    let best = 0
    let run = 0

    for (
      let week = weekKey(from, weekStartsOn);
      week <= to;
      week = addDays(week, 7)
    ) {
      const done = datesBetween(week, addDays(week, 6)).filter((date) =>
        isCompletedOn(habit, byDate, date),
      ).length
      run = done >= target ? run + 1 : 0
      best = Math.max(best, run)
    }
    return best
  }

  let best = 0
  let run = 0
  for (const date of scheduledDatesBetween(habit, from, to)) {
    run = isCompletedOn(habit, byDate, date) ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

// ----------------------------------------------------------- completion rate

export interface CompletionRate {
  /** Scheduled occurrences in the range — the denominator. */
  scheduled: number
  completed: number
  /** Whole percent, 0–100. A range with nothing scheduled is 0, not NaN. */
  percent: number
}

/**
 * How much of what was owed actually happened.
 *
 * The denominator is **scheduled occurrences, never elapsed days**. A
 * Monday-to-Friday habit over a full week is judged out of five, not seven, so
 * a perfect week reads 100 % rather than 71 %.
 *
 * A range with nothing scheduled reports 0 out of 0 at 0 % rather than
 * dividing by zero — and the caller can tell the difference between "nothing
 * was owed" and "nothing was done" by reading `scheduled`.
 */
export function calculateCompletionRate(
  habit: Habit,
  entries: HabitEntry[],
  from: DateStr,
  to: DateStr,
  weekStartsOn: WeekStart = 1,
): CompletionRate {
  const byDate = entriesByDate(entries)

  if (habit.cadence === 'weekly') {
    // Weekly habits are judged per week: the denominator is target × weeks.
    const target = weeklyTarget(habit)
    let scheduled = 0
    let completed = 0

    for (let week = weekKey(from, weekStartsOn); week <= to; week = addDays(week, 7)) {
      const done = datesBetween(week, addDays(week, 6)).filter((date) =>
        isCompletedOn(habit, byDate, date),
      ).length
      scheduled += target
      completed += Math.min(target, done)
    }
    return { scheduled, completed, percent: percentOf(completed, scheduled) }
  }

  const dates = scheduledDatesBetween(habit, from, to)
  const completed = dates.filter((date) => isCompletedOn(habit, byDate, date)).length
  return { scheduled: dates.length, completed, percent: percentOf(completed, dates.length) }
}

function percentOf(completed: number, scheduled: number): number {
  if (scheduled <= 0) return 0
  return Math.round((completed / scheduled) * 100)
}

// ----------------------------------------------------------------- history

/**
 * What a history cell can say.
 *
 * The three states are deliberately distinct: `missed` is a day the habit was
 * owed and not done, while `off` is a day it was never owed. Collapsing them
 * would make a weekday habit look like it fails every weekend — and neither
 * one has a database row, because an absent entry is exactly what "not done"
 * means.
 */
export type HabitDayState = 'done' | 'missed' | 'off' | 'future'

export interface HabitDay {
  date: DateStr
  state: HabitDayState
  /** The logged value, for quantity habits. `null` where there is no entry. */
  value: number | null
}

/** One habit's recent days, oldest first. */
export function buildHistory(
  habit: Habit,
  entries: HabitEntry[],
  from: DateStr,
  to: DateStr,
  today: DateStr,
): HabitDay[] {
  const byDate = entriesByDate(entries)

  return datesBetween(from, to).map((date) => {
    const entry = byDate.get(date)
    const value = entry && entry.deletedAt === null ? entry.value : null

    if (!isHabitScheduledOn(habit, date)) return { date, state: 'off', value }
    if (isEntryComplete(habit, entry)) return { date, state: 'done', value }
    if (date > today) return { date, state: 'future', value }
    return { date, state: 'missed', value }
  })
}
