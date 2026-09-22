import { useLiveQuery } from 'dexie-react-hooks'
import { getTodayContext, type TodayContext } from '@/services'

/**
 * The Today Engine, for the Dashboard (M19).
 *
 * One live query for the whole page, as before: every table the context read
 * is watched, so completing a task, logging a habit or finishing a focus
 * session re-derives the day in one pass rather than in ten components.
 */
export function useToday(): TodayContext | undefined {
  return useLiveQuery(() => getTodayContext(), [])
}
