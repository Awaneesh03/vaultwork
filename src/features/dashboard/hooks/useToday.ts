import { useLiveQuery } from 'dexie-react-hooks'
import { getTodayContext, type TodayContext } from '@/services'

/**
 * The Today Engine, for the Dashboard (M19).
 *
 * One live query for the whole page, as before: every table the context read
 * is watched, so completing a task, logging a habit or finishing a focus
 * session re-derives the day in one pass rather than in ten components.
 */
export function useToday(day?: string): TodayContext | undefined {
  // `day` (the local date) re-runs the query at midnight. Without it the
  // query only re-ran on a database write, so a dashboard left open overnight
  // kept yesterday's date, due-today and overdue lists until something changed.
  return useLiveQuery(() => getTodayContext(), [day])
}
