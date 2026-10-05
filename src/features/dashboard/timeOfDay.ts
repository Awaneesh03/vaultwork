import type { GreetingKey } from '@/services'

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

/**
 * Pure deterministic calculation of time-of-day based on local time.
 *
 * Local ranges:
 * - 05:00–11:59 (300 to 719 minutes) -> MORNING
 * - 12:00–16:59 (720 to 1019 minutes) -> AFTERNOON
 * - 17:00–20:59 (1020 to 1259 minutes) -> EVENING
 * - 21:00–04:59 (>= 1260 or < 300 minutes) -> NIGHT
 *
 * Strictly uses local time getters (getHours, getMinutes).
 * No UTC, no server time, no database time, no hardcoded timezone.
 */
export function getTimeOfDay(date: Date = new Date()): TimeOfDay {
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const totalMinutes = hours * 60 + minutes

  if (totalMinutes >= 5 * 60 && totalMinutes < 12 * 60) {
    return 'morning'
  }
  if (totalMinutes >= 12 * 60 && totalMinutes < 17 * 60) {
    return 'afternoon'
  }
  if (totalMinutes >= 17 * 60 && totalMinutes < 21 * 60) {
    return 'evening'
  }
  return 'night'
}

/**
 * Maps the TimeOfDay enum to Vaultwork's GreetingKey.
 */
export function greetingForTimeOfDay(timeOfDay: TimeOfDay): GreetingKey {
  switch (timeOfDay) {
    case 'morning':
      return 'morning'
    case 'afternoon':
      return 'afternoon'
    case 'evening':
      return 'evening'
    case 'night':
      return 'lateNight'
  }
}

/**
 * Computes the exact timestamp of the next time-of-day boundary relative to local time.
 * Boundaries occur at local hours: 05:00, 12:00, 17:00, 21:00.
 */
export function getNextBoundaryDate(now: Date = new Date()): Date {
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()
  const boundaries = [5, 12, 17, 21]

  for (const hour of boundaries) {
    const candidate = new Date(year, month, day, hour, 0, 0, 0)
    if (candidate.getTime() > now.getTime()) {
      return candidate
    }
  }

  // All boundaries for today have passed; the next boundary is 05:00 tomorrow
  return new Date(year, month, day + 1, 5, 0, 0, 0)
}

/**
 * Milliseconds remaining until the next time-of-day boundary.
 * Adds a small 50ms buffer to ensure execution lands slightly after the boundary minute.
 */
export function msUntilNextBoundary(now: Date = new Date()): number {
  const next = getNextBoundaryDate(now)
  return Math.max(100, next.getTime() - now.getTime() + 50)
}

/**
 * Resolves effective TimeOfDay, allowing test-only overrides for automated tests
 * without exposing visible UI controls in the user interface.
 */
export function resolveEffectiveTimeOfDay(
  clockDate: Date = new Date(),
  testOverride?: string | null,
  isDev: boolean = import.meta.env.DEV,
): { timeOfDay: TimeOfDay; greeting: GreetingKey } {
  if (isDev && testOverride && testOverride !== 'system') {
    const normalized = testOverride.trim().toLowerCase()
    if (
      normalized === 'morning' ||
      normalized === 'afternoon' ||
      normalized === 'evening' ||
      normalized === 'night'
    ) {
      const timeOfDay = normalized as TimeOfDay
      return { timeOfDay, greeting: greetingForTimeOfDay(timeOfDay) }
    }
    if (normalized === 'latenight') {
      return { timeOfDay: 'night', greeting: 'lateNight' }
    }
  }

  const timeOfDay = getTimeOfDay(clockDate)
  return { timeOfDay, greeting: greetingForTimeOfDay(timeOfDay) }
}
