import { nowTs, todayStr } from '@/lib/date'
import type { ClockPort } from '../ports'

/** The real clock. Tests inject a fake one so recurrence stays deterministic. */
export const systemClock: ClockPort = {
  now: () => nowTs(),
  today: () => todayStr(),
}
