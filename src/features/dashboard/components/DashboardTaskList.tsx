import { TaskRow } from '@/features/tasks/components/TaskRow'
import type { DateStr, Id, Project, Tag, Task } from '@/types/entities'

/**
 * A read-and-act preview of tasks, built from the real `TaskRow`.
 *
 * `TaskRow` is purely presentational and hook-free, which is exactly why it can
 * be reused here rather than reimplemented: the Dashboard gets the same
 * checkbox, the same metadata line, the same accessible labels and the same
 * density token as every other screen, for free.
 *
 * `TaskList` is deliberately *not* reused — it brings dnd-kit with it, and a
 * preview that shows six of forty tasks has no meaningful manual order to drag
 * into. Reordering belongs on the screen that shows the whole list.
 */

export interface DashboardTaskListProps {
  tasks: Task[]
  tags: Tag[]
  projects: Project[]
  today: DateStr
  progress: Map<Id, { done: number; total: number }>
  selectedTaskId: Id | null
  /** Set where the section heading already states the date. */
  hideDueDate?: boolean
  onToggle: (task: Task) => void
  onOpen: (task: Task) => void
  onDelete: (task: Task) => void
  onSelect: (id: Id) => void
}

export function DashboardTaskList({
  tasks,
  tags,
  projects,
  today,
  progress,
  selectedTaskId,
  hideDueDate = false,
  onToggle,
  onOpen,
  onDelete,
  onSelect,
}: DashboardTaskListProps) {
  return (
    <ul className="flex flex-col">
      {tasks.map((task) => (
        <li key={task.id} className="list-none">
          <TaskRow
            task={task}
            tags={tags}
            projects={projects}
            today={today}
            progress={progress.get(task.id)}
            selected={task.id === selectedTaskId}
            hideDueDate={hideDueDate}
            onToggle={() => onToggle(task)}
            onOpen={() => onOpen(task)}
            onDelete={() => onDelete(task)}
            onSelect={() => onSelect(task.id)}
          />
        </li>
      ))}
    </ul>
  )
}
