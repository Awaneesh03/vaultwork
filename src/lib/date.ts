import type { DateStr, TimeStr, Timestamp } from '@/types/entities'

/**
 * Two kinds of time, never mixed.
 *
 *   A *calendar date* — a due date, a habit day — is "YYYY-MM-DD" in local time.
 *   An *instant* — createdAt, a session start — is epoch milliseconds.
 *
 * Storing a due date as a timestamp is how tasks silently jump a day when the
 * clock changes or you travel. Everything below converts at the boundary and
 * nowhere else.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function nowTs(): Timestamp {
  return Date.now()
}

/** Local calendar day of a Date, as "YYYY-MM-DD". Never uses toISOString(). */
export function toDateStr(date: Date = new Date()): DateStr {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** "YYYY-MM-DD" -> a Date at local midnight. */
export function fromDateStr(value: DateStr): Date {
  assertDateStr(value)
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

export function todayStr(now: Date = new Date()): DateStr {
  return toDateStr(now)
}

export function addDays(value: DateStr, days: number): DateStr {
  const date = fromDateStr(value)
  date.setDate(date.getDate() + days)
  return toDateStr(date)
}

/** Calendar days between two dates, ignoring time of day entirely. */
export function daysBetween(from: DateStr, to: DateStr): number {
  const a = fromDateStr(from).getTime()
  const b = fromDateStr(to).getTime()
  return Math.round((b - a) / 86_400_000)
}

export function isDateStr(value: unknown): value is DateStr {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(y, m - 1, d)
  // Rejects 2026-02-30, which the regex alone would accept.
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function assertDateStr(value: unknown): asserts value is DateStr {
  if (!isDateStr(value)) throw new TypeError(`Expected a YYYY-MM-DD date, received ${String(value)}`)
}

export function isTimeStr(value: unknown): value is TimeStr {
  return typeof value === 'string' && TIME_RE.test(value)
}

/** Local wall-clock time of a Date, as "HH:mm". */
export function toTimeStr(date: Date = new Date()): TimeStr {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Combines a calendar date and an optional time into an instant. */
export function toInstant(date: DateStr, time: TimeStr | null = null): Timestamp {
  const base = fromDateStr(date)
  if (time && isTimeStr(time)) {
    const [h, m] = time.split(':').map(Number) as [number, number]
    base.setHours(h, m, 0, 0)
  }
  return base.getTime()
}

// ------------------------------------------------------------- presentation

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * How a due date reads to a person: "Today", then "Tomorrow", then the weekday
 * while it is still this week, then a date once the weekday would be ambiguous.
 *
 * This lives in lib/ rather than in a component because the service layer needs
 * the same wording for a CommandResult message — and in M14 for a Telegram
 * reply, where there is no component at all.
 */
export function formatDayLabel(date: DateStr, today: DateStr): string {
  const offset = daysBetween(today, date)
  if (offset === 0) return 'Today'
  if (offset === 1) return 'Tomorrow'
  if (offset === -1) return 'Yesterday'

  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const weekday = WEEKDAY_NAMES[new Date(year, month - 1, day).getDay()] ?? ''
  if (offset > 1 && offset < 7) return weekday
  return `${weekday.slice(0, 3)} ${day} ${MONTH_NAMES[month - 1] ?? ''}`
}

/** "19:00" -> "7:00 pm". Stored as 24-hour, read as whatever is natural. */
export function formatTime(time: TimeStr): string {
  if (!isTimeStr(time)) return time
  const [hour, minute] = time.split(':').map(Number) as [number, number]
  const suffix = hour < 12 ? 'am' : 'pm'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return minute === 0
    ? `${display} ${suffix}`
    : `${display}:${String(minute).padStart(2, '0')} ${suffix}`
}

/** 45 -> "45m", 90 -> "1h 30m", 120 -> "2h". */
export function formatEstimate(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/**
 * How long ago an instant was, in words.
 *
 * Relative while that is the more useful answer, then absolute: "3 days ago"
 * tells you less than "Mon 1 Sep" once you are past about a day, and a log that
 * says "14 days ago" is a log nobody can cross-reference.
 *
 * Both `now` and `today` are passed in rather than read from the wall clock, so
 * this stays pure and the caller keeps using the injected clock port.
 */
export function formatEventTime(at: Timestamp, now: Timestamp, today: DateStr): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const day = toDateStr(new Date(at))
  const hours = Math.floor(minutes / 60)
  // Hours only while it is still the same local day: "20h ago" for something
  // that happened yesterday evening is a worse answer than "Yesterday".
  if (day === today && hours < 24) return `${hours}h ago`

  if (daysBetween(day, today) === 1) return 'Yesterday'
  return formatDayLabel(day, today)
}

// ------------------------------------------------------- calendar arithmetic

/**
 * Calendar arithmetic, added in M6.
 *
 * These live here rather than in the calendar feature because they are date
 * primitives, not calendar structures: a habit streak (M7) and an analytics
 * bucket (M10) need "start of month" just as much as a month grid does. The
 * calendar's own composition — building a grid, laying out a week — is in
 * `services/calendar/`, which imports these.
 *
 * Every one of them works in `DateStr` space and converts through
 * `fromDateStr`/`toDateStr`, which read local getters. None of them can be made
 * to drift by a timezone, because none of them ever sees a UTC string.
 */

/** 0 = Sunday, 1 = Monday. The `Settings.weekStartsOn` domain. */
export type WeekStart = 0 | 1

/** Local weekday index of a calendar date. 0 = Sunday. */
export function weekdayOf(value: DateStr): number {
  return fromDateStr(value).getDay()
}

export function startOfMonth(value: DateStr): DateStr {
  const date = fromDateStr(value)
  return toDateStr(new Date(date.getFullYear(), date.getMonth(), 1))
}

/** Last day of the month, whatever its length. Handles February in a leap year. */
export function endOfMonth(value: DateStr): DateStr {
  const date = fromDateStr(value)
  // Day 0 of the *next* month is the last day of this one — the standard trick,
  // and the only one that needs no table of month lengths.
  return toDateStr(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

export function daysInMonth(value: DateStr): number {
  const date = fromDateStr(endOfMonth(value))
  return date.getDate()
}

/**
 * Adds months, clamping the day rather than overflowing.
 *
 * 31 January + 1 month is 28 February, not 3 March. `setMonth` alone gives the
 * latter, which is how a "next month" button skips February entirely.
 */
export function addMonths(value: DateStr, months: number): DateStr {
  const date = fromDateStr(value)
  const targetYear = date.getFullYear()
  const targetMonth = date.getMonth() + months
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate()
  return toDateStr(new Date(targetYear, targetMonth, Math.min(date.getDate(), lastDay)))
}

export function startOfWeek(value: DateStr, weekStartsOn: WeekStart): DateStr {
  const offset = (weekdayOf(value) - weekStartsOn + 7) % 7
  return addDays(value, -offset)
}

export function endOfWeek(value: DateStr, weekStartsOn: WeekStart): DateStr {
  return addDays(startOfWeek(value, weekStartsOn), 6)
}

export function addWeeks(value: DateStr, weeks: number): DateStr {
  return addDays(value, weeks * 7)
}

export function isSameMonth(a: DateStr, b: DateStr): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

/** Saturday and Sunday, regardless of which day the week is drawn from. */
export function isWeekend(value: DateStr): boolean {
  const day = weekdayOf(value)
  return day === 0 || day === 6
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: DateStr, to: DateStr): DateStr[] {
  const span = daysBetween(from, to)
  if (span < 0) return []
  return Array.from({ length: span + 1 }, (_, offset) => addDays(from, offset))
}

// ------------------------------------------------------------- time of day

/** "19:30" -> 1170. Minutes since local midnight. */
export function timeToMinutes(time: TimeStr): number {
  if (!isTimeStr(time)) return 0
  const [hour, minute] = time.split(':').map(Number) as [number, number]
  return hour * 60 + minute
}

/** 1170 -> "19:30". Clamped into the day, so no task can land at "24:15". */
export function minutesToTime(minutes: number): TimeStr {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  const hour = Math.floor(clamped / 60)
  const minute = clamped % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Rounds minutes to the nearest interval. The one place snapping happens.
 *
 * Half-way rounds up, so the boundaries are exact and stated: with a 15-minute
 * interval 18:07 becomes 18:00 and 18:08 becomes 18:15. Every drag handler and
 * every keyboard nudge calls this rather than rounding for itself, which is
 * what stops two surfaces disagreeing about where 18:22 belongs.
 */
export function snapMinutes(minutes: number, interval: number): number {
  if (interval <= 0) return Math.round(minutes)
  return Math.round(minutes / interval) * interval
}

/** The same, in `TimeStr` space. */
export function snapTime(time: TimeStr, interval: number): TimeStr {
  return minutesToTime(snapMinutes(timeToMinutes(time), interval))
}

// ------------------------------------------------------------- presentation

const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "September 2026". The month view's title. */
export function formatMonthLabel(value: DateStr): string {
  const [year, month] = value.split('-').map(Number) as [number, number]
  return `${LONG_MONTHS[month - 1] ?? ''} ${year}`
}

/** "Thu 3 Sep 2026". Unambiguous, and short enough for a column header. */
export function formatFullDate(value: DateStr): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const weekday = WEEKDAY_NAMES[new Date(year, month - 1, day).getDay()] ?? ''
  return `${weekday}, ${day} ${MONTH_NAMES[month - 1] ?? ''} ${year}`
}

/** "31 Aug". A day and its month, with no year. */
export function formatDayMonth(value: DateStr): string {
  const [, month, day] = value.split('-').map(Number) as [number, number, number]
  return `${day} ${MONTH_NAMES[month - 1] ?? ''}`
}

/** Full weekday name, for an accessible label. */
export function weekdayName(value: DateStr): string {
  return WEEKDAY_NAMES[weekdayOf(value)] ?? ''
}

/** The seven weekday names in display order for a given week start. */
export function weekdayHeadings(weekStartsOn: WeekStart): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_NAMES[(i + weekStartsOn) % 7] ?? '')
}

/** "7 pm" for a whole hour on the time axis. */
export function formatHour(hour: number): string {
  return formatTime(minutesToTime(hour * 60))
}
