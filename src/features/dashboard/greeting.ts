import type { GreetingKey } from '@/services'

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
  afternoon: 'Good afternoon',
  evening: 'Good evening',
}
