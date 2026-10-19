import type { GreetingKey } from '@/services'
import type { TimeOfDay } from './timeOfDay'

export type PreviewTimeOfDay = 'system' | TimeOfDay

/** Accepted `?previewTime=` values. `latenight` is an alias for `night`. */
const PREVIEWS: Record<string, TimeOfDay> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'night',
  latenight: 'night',
}

const GREETING_OF: Record<TimeOfDay, GreetingKey> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'lateNight',
}

/**
 * The time of day a development preview asks for, or `null` to follow the
 * real clock.
 *
 * `null` in a production build whatever the parameter says, and `null` for an
 * absent, `system` or unrecognised value. Own keys only: `in` would also accept
 * `constructor` or `__proto__` from Object.prototype and hand back a function.
 */
export function previewTimeOfDay(
  previewMode: string | null | undefined,
  isDev: boolean = import.meta.env.DEV,
): TimeOfDay | null {
  if (!isDev || !previewMode) return null
  const normalized = previewMode.trim().toLowerCase()
  return Object.hasOwn(PREVIEWS, normalized) ? (PREVIEWS[normalized] ?? null) : null
}

/**
 * Resolves the effective greeting: the preview's in development when one is
 * valid, otherwise the real clock's.
 */
export function resolveDashboardGreeting(
  previewMode: string | null | undefined,
  clockGreeting: GreetingKey,
  isDev: boolean = import.meta.env.DEV,
): GreetingKey {
  const preview = previewTimeOfDay(previewMode, isDev)
  return preview === null ? clockGreeting : GREETING_OF[preview]
}

/** Whether a development preview is actively overriding the system clock. */
export function isPreviewActive(
  previewMode: string | null | undefined,
  isDev: boolean = import.meta.env.DEV,
): boolean {
  return previewTimeOfDay(previewMode, isDev) !== null
}
