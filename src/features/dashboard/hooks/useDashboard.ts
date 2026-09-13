import { useLiveQuery } from 'dexie-react-hooks'
import { getDashboard, type DashboardData } from '@/services'

/**
 * The whole Dashboard, live.
 *
 * One query, one subscription. `useLiveQuery` re-runs whenever a table the
 * query touched changes — and it touches tasks, projects, tags, subtasks and
 * events — so completing a task from anywhere updates the counts, the next
 * action, the previews and the activity list together, with no cache to
 * invalidate and no second copy of a task in React state.
 *
 * `undefined` is the loading signal `DataView` is built around.
 */
export function useDashboard(): DashboardData | undefined {
  return useLiveQuery(() => getDashboard(), [])
}
