import { useLiveQuery } from 'dexie-react-hooks'
import { getTaskDetail, getTaskMetadata, type TaskDetailData } from '@/services'
import type { Id, Project, Tag } from '@/types/entities'

/** One task with its subtasks, live tags and project. */
export function useTaskDetail(id: Id | null): TaskDetailData | undefined | null {
  const detail = useLiveQuery(() => (id ? getTaskDetail(id) : Promise.resolve(null)), [id])
  return detail
}

/** Tags and projects for the composer's pickers. */
export function useTaskMetadata(): { tags: Tag[]; projects: Project[] } {
  return (
    useLiveQuery(() => getTaskMetadata(), []) ?? { tags: [], projects: [] }
  )
}
