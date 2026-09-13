import { vi } from 'vitest'
import { toDateStr } from '@/lib/date'
import { platform } from '@/platform'
import { maintenanceRepo } from '@/repositories'

/** Empties every store between tests, event log included. */
export async function resetDatabase(): Promise<void> {
  await maintenanceRepo.open()
  await maintenanceRepo.clearAll()
}

/**
 * Pins the clock port for a test.
 *
 * `today()` is fixed, so a Today or Upcoming view is deterministic. `now()`
 * advances by a millisecond per call, which is what keeps the event log's
 * ordering assertable — a genuinely frozen instant would give every event the
 * same `at` and make "which happened first?" unanswerable.
 *
 * Faking global timers instead would break fake-indexeddb, which is exactly
 * why the clock is a port.
 */
export function freezeClock(now: Date): { at: () => number } {
  let tick = now.getTime()
  vi.spyOn(platform.clock, 'today').mockReturnValue(toDateStr(now))
  vi.spyOn(platform.clock, 'now').mockImplementation(() => tick++)
  return { at: () => tick }
}

/**
 * Polls an assertion on real timers, outside React's `act`.
 *
 * Testing Library's `waitFor` and `findBy*` poll from inside `act`, which in
 * this jsdom + fake-indexeddb setup can starve Dexie's liveQuery task queue:
 * the DOM does update, but only once control returns to real timers, so the
 * poll never observes it however long its timeout is.
 *
 * Most assertions never need this — a click driving one query settles inside
 * `waitFor` fine. It matters when an interaction rebuilds the query itself (a
 * new options object, so a new subscription). Same shape as `waitFor`, just
 * scheduled where the subscription can actually deliver.
 */
export async function waitOutsideAct(
  check: () => void | Promise<void>,
  { timeout = 4000, interval = 50 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const started = Date.now()
  for (;;) {
    try {
      await check()
      return
    } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }
}
