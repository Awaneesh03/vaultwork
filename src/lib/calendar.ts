import {
  addDays,
  addMonths,
  addWeeks,
  datesBetween,
  endOfMonth,
  endOfWeek,
  formatDayMonth,
  formatFullDate,
  formatMonthLabel,
  startOfMonth,
  startOfWeek,
  type WeekStart,
} from './date'
import type { DateStr } from '@/types/entities'

/**
 * The shapes a calendar is made of, as pure functions over `DateStr`.
 *
 * `date.ts` owns date *arithmetic*; this owns calendar *structure* — what a
 * month grid is, which dates a period covers, how a period moves. Keeping the
 * split means the month grid is one composition of primitives rather than a
 * second date implementation, and every rule below is testable without a
 * database, a clock or a DOM.
 *
 * It lives in `lib/` rather than in `services/` because it is a leaf: it
 * imports nothing but `date.ts` and the entity types, and both the calendar
 * *service* and the calendar *components* need it. A pure grid calculation
 * behind the service boundary would have to be re-exported through a hook to
 * reach the component that draws the grid, which buys nothing.
 */

export const CALENDAR_MODES = ['month', 'week', 'day'] as const
export type CalendarMode = (typeof CALENDAR_MODES)[number]

export function isCalendarMode(value: string): value is CalendarMode {
  return (CALENDAR_MODES as readonly string[]).includes(value)
}

/** Minutes a dragged or nudged time snaps to. One interval, one place. */
export const SNAP_MINUTES = 15

/** The hours the week and day grids draw. A full local day, never truncated. */
export const DAY_START_HOUR = 0
export const DAY_END_HOUR = 24
export const HOURS_IN_DAY = DAY_END_HOUR - DAY_START_HOUR

/**
 * The dates a month grid covers: whole weeks, from the week containing the 1st
 * to the week containing the last day.
 *
 * The row count is derived rather than fixed at six. A month that happens to
 * fit in four or five weeks renders four or five, instead of padding the grid
 * with a whole week of a neighbouring month that has nothing to say.
 */
export function monthGridRange(
  anchor: DateStr,
  weekStartsOn: WeekStart,
): {
  from: DateStr
  to: DateStr
} {
  return {
    from: startOfWeek(startOfMonth(anchor), weekStartsOn),
    to: endOfWeek(endOfMonth(anchor), weekStartsOn),
  }
}

/** The month grid as rows of seven dates. */
export function monthGrid(anchor: DateStr, weekStartsOn: WeekStart): DateStr[][] {
  const { from, to } = monthGridRange(anchor, weekStartsOn)
  const all = datesBetween(from, to)

  const rows: DateStr[][] = []
  for (let i = 0; i < all.length; i += 7) rows.push(all.slice(i, i + 7))
  return rows
}

/** The seven dates of the week containing `anchor`. */
export function weekDates(anchor: DateStr, weekStartsOn: WeekStart): DateStr[] {
  const from = startOfWeek(anchor, weekStartsOn)
  return Array.from({ length: 7 }, (_, offset) => addDays(from, offset))
}

/**
 * The inclusive date range a view needs to read.
 *
 * This is what keeps the calendar off the whole task table: the query asks for
 * exactly the days it is about to draw — adjacent-month days included, because
 * the month grid shows them and they must not be blank when they hold work.
 */
export function visibleRange(
  mode: CalendarMode,
  anchor: DateStr,
  weekStartsOn: WeekStart,
): { from: DateStr; to: DateStr } {
  switch (mode) {
    case 'month':
      return monthGridRange(anchor, weekStartsOn)
    case 'week':
      return { from: startOfWeek(anchor, weekStartsOn), to: endOfWeek(anchor, weekStartsOn) }
    case 'day':
      return { from: anchor, to: anchor }
  }
}

/** Moves the anchor one period forward (`+1`) or back (`-1`). */
export function shiftPeriod(mode: CalendarMode, anchor: DateStr, delta: number): DateStr {
  switch (mode) {
    case 'month':
      return addMonths(anchor, delta)
    case 'week':
      return addWeeks(anchor, delta)
    case 'day':
      return addDays(anchor, delta)
  }
}

/** What the toolbar says the period is. */
export function periodTitle(mode: CalendarMode, anchor: DateStr, weekStartsOn: WeekStart): string {
  switch (mode) {
    case 'month':
      return formatMonthLabel(anchor)
    case 'week': {
      const from = startOfWeek(anchor, weekStartsOn)
      const to = endOfWeek(anchor, weekStartsOn)

      // The label says as much as it has to and no more: one month name when
      // the week sits inside a month, two when it straddles one, and both
      // years only when it straddles a year as well.
      if (from.slice(0, 7) === to.slice(0, 7)) {
        return `${Number(from.slice(8))} – ${Number(to.slice(8))} ${formatMonthLabel(from)}`
      }
      if (from.slice(0, 4) === to.slice(0, 4)) {
        return `${formatDayMonth(from)} – ${formatDayMonth(to)} ${from.slice(0, 4)}`
      }
      return `${formatDayMonth(from)} ${from.slice(0, 4)} – ${formatDayMonth(to)} ${to.slice(0, 4)}`
    }
    case 'day':
      return formatFullDate(anchor)
  }
}

// ------------------------------------------------------------- time placement

/**
 * Where a minute-of-day sits in a time grid, as a fraction from 0 to 1.
 *
 * The component multiplies this by its own row height, so the placement rule
 * lives here and the pixels stay in CSS — which is what makes "19:00 appears at
 * 19:00" assertable without rendering anything.
 */
export function minuteFraction(minutes: number): number {
  const span = HOURS_IN_DAY * 60
  return Math.max(0, Math.min(1, (minutes - DAY_START_HOUR * 60) / span))
}

/** The hours a time axis draws, in order. */
export function axisHours(): number[] {
  return Array.from({ length: HOURS_IN_DAY }, (_, i) => DAY_START_HOUR + i)
}

/**
 * The snap-interval offsets inside one hour: [0, 15, 30, 45].
 *
 * The time grid renders one drop target per entry, which is what makes a drag
 * land on an exact quarter *by construction* rather than by measuring pixels
 * against a container that dnd-kit may be auto-scrolling underneath it. The
 * target is the answer; there is no arithmetic left to get wrong.
 */
export function slotOffsets(): number[] {
  return Array.from({ length: 60 / SNAP_MINUTES }, (_, i) => i * SNAP_MINUTES)
}
