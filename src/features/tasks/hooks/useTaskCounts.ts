import { useLiveQuery } from 'dexie-react-hooks'
import { getTaskCounts, type TaskCounts } from '@/services'

/** Badge counts for the sidebar. One pass over the live rows, not six queries. */
export function useTaskCounts(): TaskCounts | undefined {
  return useLiveQuery(() => getTaskCounts(), [])
}
