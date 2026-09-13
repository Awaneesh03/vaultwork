import { useLiveQuery } from 'dexie-react-hooks'
import { getProjectsView, type ProjectsViewData } from '@/services'
import { useProjectUiStore } from '@/store/projectUiStore'

/**
 * The Projects screen's data, live.
 *
 * `useLiveQuery` re-runs whenever a Dexie table the query touched changes — and
 * the query touches both `projects` and `tasks`, so completing a task updates
 * its project's progress bar with no cache to invalidate and no second copy of
 * a count anywhere in React state.
 *
 * `undefined` is the loading signal `DataView` is built around.
 */
export function useProjectsView(): ProjectsViewData | undefined {
  const filter = useProjectUiStore((s) => s.filter)
  const sort = useProjectUiStore((s) => s.sort)

  return useLiveQuery(
    () => getProjectsView({ filter, sort }),
    // The filter object is rebuilt on every store write, so the dependency list
    // spells out its fields rather than relying on its identity.
    [sort, filter.state, filter.progress, filter.status, filter.search],
  )
}
