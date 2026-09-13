import { useLiveQuery } from 'dexie-react-hooks'
import { getTaskView, type TaskViewData, type TaskViewId } from '@/services'
import { useTaskUiStore } from '@/store/taskUiStore'

/**
 * One view's worth of tasks, live.
 *
 * `useLiveQuery` re-runs whenever a Dexie table the query touched changes, so a
 * completion from a keyboard shortcut, a Quick Add, the palette — or in M14 a
 * Telegram message — refreshes the list with no cache to invalidate and no
 * duplicated copy of a task anywhere in React state.
 *
 * `undefined` is the loading signal `DataView` is built around.
 */
export function useTaskView(view: TaskViewId): TaskViewData | undefined {
  const filter = useTaskUiStore((s) => s.filter)
  const sort = useTaskUiStore((s) => s.sort)
  const direction = useTaskUiStore((s) => s.direction)
  const upcomingDays = useTaskUiStore((s) => s.upcomingDays)

  return useLiveQuery(
    () =>
      getTaskView(view, {
        filter,
        sort: sort ?? undefined,
        direction: direction ?? undefined,
        upcomingDays,
      }),
    // The filter object is rebuilt on every store write, so the dependency list
    // spells out its fields rather than relying on its identity.
    [
      view,
      sort,
      direction,
      upcomingDays,
      filter.search,
      filter.due,
      filter.hasEstimate,
      filter.projectId,
      filter.tagMode,
      filter.priorities.join(','),
      filter.tagIds.join(','),
    ],
  )
}
