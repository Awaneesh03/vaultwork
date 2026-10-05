import type { GreetingKey } from '@/services'

export type PreviewTimeOfDay = 'system' | 'morning' | 'afternoon' | 'evening' | 'night'

export const PREVIEW_OPTIONS: readonly { id: PreviewTimeOfDay; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
  { id: 'night', label: 'Night' },
] as const

const PREVIEW_TO_GREETING: Record<Exclude<PreviewTimeOfDay, 'system'>, GreetingKey> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'lateNight',
}

/**
 * Resolves the effective time-of-day greeting for the Dashboard.
 *
 * In development mode, if a valid preview mode is selected (or passed via query parameter):
 *   morning   -> 'morning'
 *   afternoon -> 'afternoon'
 *   evening   -> 'evening'
 *   night     -> 'lateNight'
 *
 * If previewMode is 'system', null, undefined, invalid, or running in a production build
 * (import.meta.env.DEV is false), it safely returns the real clockGreeting.
 */
export function resolveDashboardGreeting(
  previewMode: string | null | undefined,
  clockGreeting: GreetingKey,
  isDev: boolean = import.meta.env.DEV,
): GreetingKey {
  if (!isDev || !previewMode || previewMode === 'system') {
    return clockGreeting
  }

  const normalized = previewMode.trim().toLowerCase()
  if (normalized in PREVIEW_TO_GREETING) {
    return PREVIEW_TO_GREETING[normalized as keyof typeof PREVIEW_TO_GREETING]
  }

  // Also support 'latenight' safely as an alias for 'night'
  if (normalized === 'latenight') {
    return 'lateNight'
  }

  return clockGreeting
}

/**
 * Whether a development preview is actively overriding the system clock.
 */
export function isPreviewActive(
  previewMode: string | null | undefined,
  isDev: boolean = import.meta.env.DEV,
): boolean {
  if (!isDev || !previewMode || previewMode === 'system') return false
  const normalized = previewMode.trim().toLowerCase()
  return normalized in PREVIEW_TO_GREETING || normalized === 'latenight'
}
