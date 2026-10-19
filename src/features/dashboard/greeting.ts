import type { GreetingKey } from '@/services'
import type { TimeOfDay } from './timeOfDay'

/**
 * How each greeting reads.
 *
 * The service decides *which* greeting the hour calls for; the wording is
 * presentation, and it lives in the feature layer for the same reason
 * `PRIORITY_LABELS` and `PROJECT_STATUS_LABELS` do — a service that returns
 * English is a service you cannot translate or reuse from a message channel.
 *
 * `dashboardStats.test.ts` asserts every key the service can return has a
 * label here, so the two cannot drift.
 */
export const GREETINGS: Record<GreetingKey, string> = {
  // 21:00–04:59. "Still up" was written when night began at midnight, and
  // read wrongly at ten in the evening.
  lateNight: 'Good night',
  morning: 'Good morning',
  afternoon: 'Make today count',
  evening: 'Good evening',
}

/**
 * The words around the greeting, per time of day: the eyebrow above it and
 * the line beneath. Keyed by the same `TimeOfDay` that picks the hero's scene,
 * so words and sky change together.
 */
export const SCENE_COPY: Record<TimeOfDay, { eyebrow: string; subtitle: string }> = {
  morning: { eyebrow: 'Morning Focus', subtitle: 'A fresh start. Let’s make today count.' },
  afternoon: { eyebrow: 'Day in Motion', subtitle: 'Keep moving. Every small step matters.' },
  evening: { eyebrow: 'Evening Wrap-Up', subtitle: 'Great progress today. Let’s wrap things up.' },
  night: { eyebrow: 'Night Wind-Down', subtitle: 'Time to rest. Tomorrow is lined up below.' },
}

/** Each sky's own light, for the hero's border and the eyebrow's dot. */
export const SCENE_TINT: Record<TimeOfDay, string> = {
  morning: '#f0a878',
  afternoon: '#f4c45a',
  evening: 'var(--warn)',
  night: '#b9c6ff',
}
