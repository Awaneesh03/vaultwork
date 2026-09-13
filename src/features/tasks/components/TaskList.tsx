import { useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { DateStr, Id, Project, Tag, Task } from '@/types/entities'
import { TaskRow } from './TaskRow'

/**
 * A reorderable list of tasks.
 *
 * Two things matter here.
 *
 * **Keyboard support is not an add-on.** dnd-kit's `KeyboardSensor` with
 * `sortableKeyboardCoordinates` makes the grip a real button: space picks a
 * task up, the arrows move it, space drops it, escape cancels — and the
 * announcements below say what happened out loud. A drag-and-drop list that
 * only works with a mouse is a list some people cannot reorder at all.
 *
 * **One drop writes one row.** `onMove` reports indices; the service turns them
 * into a single midpoint `sortOrder`. The list is never renumbered, so a drag
 * costs one write and one event instead of N.
 */

export interface TaskListProps {
  tasks: Task[]
  tags: Tag[]
  projects: Project[]
  today: DateStr
  progress: Map<Id, { done: number; total: number }>
  selectedTaskId: Id | null
  /** Off for sections whose order is meaningful (Overdue, Scheduled). */
  sortable: boolean
  hideDueDate?: boolean
  /** Off for the project screen, where every row shares one project. */
  hideProject?: boolean
  onMove: (orderedIds: Id[], fromIndex: number, toIndex: number) => void
  onToggle: (task: Task) => void
  onOpen: (task: Task) => void
  onDelete: (task: Task) => void
  onSelect: (id: Id) => void
}

function SortableRow({
  task,
  enabled,
  ...rest
}: { task: Task; enabled: boolean } & Omit<
  Parameters<typeof TaskRow>[0],
  'task' | 'handle' | 'dragging'
>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !enabled,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
      className={cn('list-none', isDragging && 'relative z-10')}
    >
      <TaskRow
        task={task}
        dragging={isDragging}
        handle={
          enabled ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${task.title}`}
              className={cn(
                'mt-[3px] -ml-1 cursor-grab rounded p-0.5 text-ink-3 opacity-0 transition-opacity',
                'hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100',
                'touch-none active:cursor-grabbing',
              )}
            >
              <GripVertical size={13} aria-hidden />
            </button>
          ) : (
            <span className="mt-[3px] -ml-1 w-[18px] shrink-0" aria-hidden />
          )
        }
        {...rest}
      />
    </li>
  )
}

export function TaskList({
  tasks,
  tags,
  projects,
  today,
  progress,
  selectedTaskId,
  sortable,
  hideDueDate = false,
  hideProject = false,
  onMove,
  onToggle,
  onOpen,
  onDelete,
  onSelect,
}: TaskListProps) {
  const [activeId, setActiveId] = useState<Id | null>(null)
  const ids = useMemo(() => tasks.map((task) => task.id), [tasks])

  const sensors = useSensors(
    // A few pixels of slop so clicking a checkbox never starts a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const index = ids.indexOf(String(active.id))
        const task = tasks[index]
        return task ? `Picked up ${task.title}, position ${index + 1} of ${ids.length}.` : undefined
      },
      onDragOver: ({ active, over }) => {
        if (!over) return undefined
        const task = tasks[ids.indexOf(String(active.id))]
        const to = ids.indexOf(String(over.id)) + 1
        return task ? `${task.title} is now at position ${to} of ${ids.length}.` : undefined
      },
      onDragEnd: ({ active, over }) => {
        const task = tasks[ids.indexOf(String(active.id))]
        if (!task) return undefined
        if (!over) return `${task.title} was returned to its position.`
        return `${task.title} dropped at position ${ids.indexOf(String(over.id)) + 1}.`
      },
      onDragCancel: ({ active }) => {
        const task = tasks[ids.indexOf(String(active.id))]
        return task ? `Reordering cancelled. ${task.title} is back where it was.` : undefined
      },
    }),
    [ids, tasks],
  )

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id))

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    onMove(ids, from, to)
  }

  const rows = tasks.map((task) => (
    <SortableRow
      key={task.id}
      task={task}
      enabled={sortable}
      tags={tags}
      projects={projects}
      today={today}
      progress={progress.get(task.id)}
      selected={task.id === selectedTaskId}
      hideDueDate={hideDueDate}
      hideProject={hideProject}
      onToggle={() => onToggle(task)}
      onOpen={() => onOpen(task)}
      onDelete={() => onDelete(task)}
      onSelect={() => onSelect(task.id)}
    />
  ))

  if (!sortable) {
    return <ul className="flex flex-col">{rows}</ul>
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{ announcements }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={cn('flex flex-col', activeId && 'select-none')}>{rows}</ul>
      </SortableContext>
    </DndContext>
  )
}
