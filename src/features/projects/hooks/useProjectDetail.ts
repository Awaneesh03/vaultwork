import { useLiveQuery } from 'dexie-react-hooks'
import { getProject, getProjectDetail, type ProjectDetailData } from '@/services'
import { useTaskUiStore } from '@/store/taskUiStore'
import type { Id, Project } from '@/types/entities'

/**
 * One project and its tasks, live.
 *
 * The task filter comes from `taskUiStore` — the same store the six task views
 * use, driving the same `TaskToolbar`. A project's task list is the task list;
 * giving it a private filter store would be the beginning of a second task
 * implementation, which is exactly what M4 must not build.
 *
 * Three return values, all meaningful: `undefined` while loading, `null` for a
 * project that does not exist (a stale bookmark, a deleted project), and the
 * data otherwise.
 */
export function useProjectDetail(projectId: Id | undefined): ProjectDetailData | null | undefined {
  const filter = useTaskUiStore((s) => s.filter)
  const sort = useTaskUiStore((s) => s.sort)
  const direction = useTaskUiStore((s) => s.direction)

  return useLiveQuery(async () => {
    if (!projectId) return null
    const data = await getProjectDetail(projectId, {
      // `status` is forced to 'all': the detail view shows open and completed
      // work in two sections, so the toolbar's status is not its business.
      filter: { ...filter, status: 'all' },
      sort: sort ?? 'manual',
      ...(direction === null ? {} : { direction }),
    })
    return data ?? null
  }, [
    projectId,
    sort,
    direction,
    filter.search,
    filter.due,
    filter.hasEstimate,
    filter.tagMode,
    filter.priorities.join(','),
    filter.tagIds.join(','),
  ])
}

/** Just the project row — for the composer, which needs no task counts. */
export function useProject(projectId: Id | null): Project | null | undefined {
  return useLiveQuery(async () => {
    if (!projectId) return null
    return (await getProject(projectId)) ?? null
  }, [projectId])
}
