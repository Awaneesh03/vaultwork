import type { HabitFrequency } from '@/services'

/**
 * How a habit reads on screen.
 *
 * Colour names reuse M4's project palette tokens rather than introducing a
 * second colour system — a habit's `color` field holds the same kind of name a
 * project's does, and both resolve through `projectColorVar`.
 */
export const HABIT_FREQUENCY_LABELS: Record<HabitFrequency, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  custom: 'Custom days',
  weekly: 'Times per week',
}

/** Single letters for the weekday picker, Sunday first to match `getDay()`. */
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/** "Mon, Wed, Fri" — how a custom day set reads. */
export function describeDays(days: number[]): string {
  if (days.length === 0) return 'Every day'
  return [...days]
    .sort()
    .map((day) => WEEKDAY_NAMES[day]?.slice(0, 3) ?? '')
    .join(', ')
}
