import { datesBetween, startOfWeek, toDateStr, weekdayOf, type WeekStart } from '@/lib/date'
import type { DateStr, Habit } from '@/types/entities'

/**
 * When a habit is expected, as pure functions.
 *
 * Nothing here touches Dexie, React, the clock or a browser API: every answer
 * is derived from the habit row and a date handed in. That is what makes "is
 * this habit due on a Sunday?" a plain assertion rather than something you
 * have to click through a UI to find out.
 *
 * ---------------------------------------------------------------------------
 * The model this reads, and what each field means
 *
 * The M1 `Habit` row already carries a schedule, so M7 adds no fields:
 *
 *   cadence: 'daily'   — expected on particular *days*.
 *     daysOfWeek: []          → every day
 *     daysOfWeek: [1..5]      → weekdays
 *     daysOfWeek: [1, 3, 5]   → a custom set
 *
 *   cadence: 'weekly'  — expected `targetPerWeek` times *within a week*, on
 *     whichever days suit. The unit of success is the week, not the day.
 *
 * `daysOfWeek` is numeric, 0 = Sunday, matching `Date.getDay()` and the comment
 * the model already carried. Weekday *names* are never persisted: they are a
 * presentation concern and they are not stable across locales.
 */

/** 0 = Sunday, matching `Date.getDay()` and `Habit.daysOfWeek`. */
export const WEEKDAY_VALUES = [0, 1, 2, 3, 4, 5, 6] as const

/** Monday to Friday, the set the "Weekdays" preset writes. */
export const WEEKDAYS = [1, 2, 3, 4, 5]

/**
 * The four schedules the composer offers, as a label over the same two model
 * fields. This is a *presentation* grouping, not a second schema: every one of
 * them round-trips to `cadence` + `daysOfWeek` + `targetPerWeek`.
 */
export type HabitFrequency = 'daily' | 'weekdays' | 'custom' | 'weekly'

export function frequencyOf(habit: Habit): HabitFrequency {
  if (habit.cadence === 'weekly') return 'weekly'
  if (habit.daysOfWeek.length === 0) return 'daily'
  if (sameDays(habit.daysOfWeek, WEEKDAYS)) return 'weekdays'
  return 'custom'
}

function sameDays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}

/**
 * Is this habit expected on this date?
 *
 * The one question the whole feature turns on. A *weekly* habit is expected on
 * every day of its week — you may do it whenever — so "scheduled" is true each
 * day and success is judged per week instead. A *daily* habit is expected only
 * on the weekdays it names.
 *
 * Two things deliberately do **not** appear in this answer: whether the habit
 * is archived, and whether it is deleted. Those are questions about the habit's
 * lifecycle, not its schedule, and mixing them in would make a history view
 * unable to say "this used to be due on Mondays".
 */
export function isHabitScheduledOn(habit: Habit, date: DateStr): boolean {
  if (habit.cadence === 'weekly') return true
  if (habit.daysOfWeek.length === 0) return true
  return habit.daysOfWeek.includes(weekdayOf(date))
}

/** Whether a habit is live and unarchived — the "should I see it today" test. */
export function isHabitActive(habit: Habit): boolean {
  return habit.deletedAt === null && habit.archivedAt === null
}

/**
 * The dates in a range on which a habit is expected.
 *
 * Ordered oldest first. Used by streaks, completion rate and the history strip
 * so all three agree on what "an occurrence" is.
 */
export function scheduledDatesBetween(habit: Habit, from: DateStr, to: DateStr): DateStr[] {
  return datesBetween(from, to).filter((date) => isHabitScheduledOn(habit, date))
}

/**
 * The first date a habit can be judged on: the day it was created.
 *
 * A habit created on Thursday was not "missed" on Wednesday, and counting the
 * days before it existed as failures is the fastest way to make a streak
 * meaningless.
 */
export function habitStartDate(habit: Habit): DateStr {
  return toDateStr(new Date(habit.createdAt))
}

/**
 * The week a date belongs to, as the date of its first day.
 *
 * Weekly habits are judged per week, so every weekly calculation keys on this
 * rather than on the raw date. The week start comes from Settings, so a user
 * who starts weeks on Sunday gets Sunday-based weeks everywhere.
 */
export function weekKey(date: DateStr, weekStartsOn: WeekStart): DateStr {
  return startOfWeek(date, weekStartsOn)
}

/** How many times a week a weekly habit is meant to be done. At least once. */
export function weeklyTarget(habit: Habit): number {
  return Math.max(1, habit.targetPerWeek ?? 1)
}
