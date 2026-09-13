import { useLiveQuery } from 'dexie-react-hooks'
import { getCalendar, type CalendarData } from '@/services'
import { useCalendarUiStore } from '@/store/calendarUiStore'

/**
 * The visible calendar period, live.
 *
 * One query per period. `useLiveQuery` re-runs whenever a table it touched
 * changes — tasks, tags, projects, subtasks, settings — so completing a task,
 * rescheduling one from anywhere in the app, or switching the week start in
 * Settings all redraw the grid with no cache to invalidate.
 *
 * `undefined` is the loading signal `DataView` is built around.
 */
export function useCalendar(): CalendarData | undefined {
  const mode = useCalendarUiStore((s) => s.mode)
  const anchor = useCalendarUiStore((s) => s.anchor)
  const status = useCalendarUiStore((s) => s.status)

  // A null anchor means "whatever today is" — the service resolves it from the
  // clock port and reports it back on `data.anchor`, which the screen then
  // writes into the store. The UI never reads a clock of its own.
  return useLiveQuery(
    () => getCalendar({ mode, status, ...(anchor === null ? {} : { anchor }) }),
    [mode, anchor, status],
  )
}
