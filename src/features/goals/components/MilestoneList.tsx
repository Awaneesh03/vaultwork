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
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, Check, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { MilestoneView } from '@/services'
import { formatGoalDate } from '../goalAppearance'
import type { Id } from '@/types/entities'

/**
 * The checkpoints of one goal, reorderable.
 *
 * Two things this list is careful about:
 *
 *  - The checkbox reports the milestone's **own** `done` flag, and the task
 *    count sits beside it as separate information. A checkpoint can be met with
 *    tasks still open, and that is a legitimate state the user chose — showing
 *    one derived number would make it inexpressible.
 *
 *  - Reordering has a keyboard path that is not a drag: every row carries Move
 *    up / Move down buttons as well as a grip, because a pointer drag is not an
 *    accessible way to offer the only means of doing something.
 */

export interface MilestoneListProps {
  views: MilestoneView[]
  today: string
  onToggle: (id: Id) => void
  onEdit: (id: Id) => void
  onDelete: (id: Id) => void
  onMove: (orderedIds: Id[], fromIndex: number, toIndex: number) => void
}

interface RowProps {
  view: MilestoneView
  today: string
  index: number
  count: number
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

function Row({
  view,
  today,
  index,
  count,
  onToggle,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: RowProps) {
  const { milestone, tasks, overdue } = view
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: milestone.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
      className={cn('list-none', isDragging && 'relative z-10 opacity-40')}
    >
      <div className="group/ms flex items-start gap-2 rounded-md border border-transparent px-1.5 py-1.5 hover:border-line hover:bg-surface">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${milestone.title}`}
          className={cn(
            'mt-[3px] cursor-grab rounded p-0.5 text-ink-3 opacity-0 transition-opacity',
            'hover:text-ink focus-visible:opacity-100 group-hover/ms:opacity-100',
            'touch-none active:cursor-grabbing',
          )}
        >
          <GripVertical size={12} aria-hidden />
        </button>

        <button
          type="button"
          role="checkbox"
          aria-checked={milestone.done}
          aria-label={
            milestone.done ? `Reopen ${milestone.title}` : `Complete ${milestone.title}`
          }
          onClick={onToggle}
          className={cn(
            'mt-[2px] grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[4px] border',
            'transition-colors duration-[var(--duration-fast)]',
            milestone.done
              ? 'border-transparent bg-accent text-accent-ink'
              : 'border-line-strong text-transparent hover:border-accent',
          )}
        >
          <Check size={11} strokeWidth={3} aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                'text-[13px] leading-snug',
                milestone.done ? 'text-ink-3 line-through' : 'text-ink',
              )}
            >
              {milestone.title}
            </span>

            {milestone.targetDate !== null ? (
              <span
                className={cn(
                  'tabular shrink-0 text-[11px]',
                  overdue ? 'text-danger' : 'text-ink-3',
                )}
              >
                {formatGoalDate(milestone.targetDate, today)}
                {overdue ? ' · late' : ''}
              </span>
            ) : null}

            {tasks.total > 0 ? (
              <span
                className="tabular shrink-0 rounded-sm bg-sunken px-1.5 py-px text-[10.5px] text-ink-3"
                aria-label={`${tasks.done} of ${tasks.total} tasks complete under ${milestone.title}`}
              >
                {tasks.done}/{tasks.total} tasks
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/ms:opacity-100">
          {/* A keyboard route to reordering that is not a drag. */}
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label={`Move ${milestone.title} up`}
            className="rounded p-1 text-ink-3 hover:bg-elevated hover:text-ink disabled:opacity-30"
          >
            <ArrowUp size={12} />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === count - 1}
            aria-label={`Move ${milestone.title} down`}
            className="rounded p-1 text-ink-3 hover:bg-elevated hover:text-ink disabled:opacity-30"
          >
            <ArrowDown size={12} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${milestone.title}`}
            className="rounded p-1 text-ink-3 hover:bg-elevated hover:text-ink"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${milestone.title}`}
            className="rounded p-1 text-ink-3 hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </li>
  )
}

export function MilestoneList({
  views,
  today,
  onToggle,
  onEdit,
  onDelete,
  onMove,
}: MilestoneListProps) {
  const [dragging, setDragging] = useState(false)
  const ids = useMemo(() => views.map((view) => view.milestone.id), [views])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const index = ids.indexOf(String(active.id))
        const title = views[index]?.milestone.title
        return title ? `Picked up ${title}, position ${index + 1} of ${ids.length}.` : undefined
      },
      onDragOver: ({ active, over }) => {
        if (!over) return undefined
        const title = views[ids.indexOf(String(active.id))]?.milestone.title
        return title
          ? `${title} is now at position ${ids.indexOf(String(over.id)) + 1} of ${ids.length}.`
          : undefined
      },
      onDragEnd: ({ active, over }) => {
        const title = views[ids.indexOf(String(active.id))]?.milestone.title
        if (!title) return undefined
        if (!over) return `${title} was returned to its position.`
        return `${title} dropped at position ${ids.indexOf(String(over.id)) + 1}.`
      },
      onDragCancel: () => 'Reordering cancelled.',
    }),
    [ids, views],
  )

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(false)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    onMove(ids, from, to)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{ announcements }}
      onDragStart={() => setDragging(true)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(false)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={cn('flex flex-col gap-0.5', dragging && 'select-none')}>
          {views.map((view, index) => (
            <Row
              key={view.milestone.id}
              view={view}
              today={today}
              index={index}
              count={views.length}
              onToggle={() => onToggle(view.milestone.id)}
              onEdit={() => onEdit(view.milestone.id)}
              onDelete={() => onDelete(view.milestone.id)}
              onMoveUp={() => onMove(ids, index, index - 1)}
              onMoveDown={() => onMove(ids, index, index + 1)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
