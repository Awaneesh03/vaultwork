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
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { GoalListItem } from '@/services'
import type { Id } from '@/types/entities'
import { GoalRow } from './GoalRow'

/**
 * A reorderable list of goals.
 *
 * The same machinery `TaskList`, `ProjectList` and `HabitList` use rather than
 * a fourth implementation: the grip is a real button that space picks up and
 * the arrows move, with spoken announcements, and one drop writes one row
 * because the service turns the indices into a single midpoint `sortOrder`.
 */

export interface GoalListProps {
  items: GoalListItem[]
  today: string
  selectedGoalId: Id | null
  /** Off when a sort other than manual is chosen — dragging would lie. */
  sortable: boolean
  onMove: (orderedIds: Id[], fromIndex: number, toIndex: number) => void
  onOpen: (id: Id) => void
  onComplete: (id: Id) => void
  onEdit: (id: Id) => void
  onArchive: (id: Id) => void
  onDelete: (id: Id) => void
  onSelect: (id: Id) => void
}

function SortableRow({
  enabled,
  item,
  ...rest
}: { enabled: boolean } & Omit<Parameters<typeof GoalRow>[0], 'handle' | 'dragging'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.goal.id,
    disabled: !enabled,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
      className={cn('list-none', isDragging && 'relative z-10')}
    >
      <GoalRow
        item={item}
        dragging={isDragging}
        handle={
          enabled ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${item.goal.title}`}
              className={cn(
                'mt-[4px] -ml-1 cursor-grab rounded p-0.5 text-ink-3 opacity-0 transition-opacity',
                'hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100',
                'touch-none active:cursor-grabbing',
              )}
            >
              <GripVertical size={13} aria-hidden />
            </button>
          ) : (
            <span className="mt-[4px] -ml-1 w-[18px] shrink-0" aria-hidden />
          )
        }
        {...rest}
      />
    </li>
  )
}

export function GoalList({
  items,
  today,
  selectedGoalId,
  sortable,
  onMove,
  onOpen,
  onComplete,
  onEdit,
  onArchive,
  onDelete,
  onSelect,
}: GoalListProps) {
  const [dragging, setDragging] = useState(false)
  const ids = useMemo(() => items.map((item) => item.goal.id), [items])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const index = ids.indexOf(String(active.id))
        const title = items[index]?.goal.title
        return title ? `Picked up ${title}, position ${index + 1} of ${ids.length}.` : undefined
      },
      onDragOver: ({ active, over }) => {
        if (!over) return undefined
        const title = items[ids.indexOf(String(active.id))]?.goal.title
        const to = ids.indexOf(String(over.id)) + 1
        return title ? `${title} is now at position ${to} of ${ids.length}.` : undefined
      },
      onDragEnd: ({ active, over }) => {
        const title = items[ids.indexOf(String(active.id))]?.goal.title
        if (!title) return undefined
        if (!over) return `${title} was returned to its position.`
        return `${title} dropped at position ${ids.indexOf(String(over.id)) + 1}.`
      },
      onDragCancel: ({ active }) => {
        const title = items[ids.indexOf(String(active.id))]?.goal.title
        return title ? `Reordering cancelled. ${title} is back where it was.` : undefined
      },
    }),
    [ids, items],
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

  const rows = items.map((item) => (
    <SortableRow
      key={item.goal.id}
      item={item}
      today={today}
      enabled={sortable}
      selected={item.goal.id === selectedGoalId}
      onOpen={() => onOpen(item.goal.id)}
      onComplete={() => onComplete(item.goal.id)}
      onEdit={() => onEdit(item.goal.id)}
      onArchive={() => onArchive(item.goal.id)}
      onDelete={() => onDelete(item.goal.id)}
      onSelect={() => onSelect(item.goal.id)}
    />
  ))

  if (!sortable) return <ul className="flex flex-col gap-0.5">{rows}</ul>

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
        <ul className={cn('flex flex-col gap-0.5', dragging && 'select-none')}>{rows}</ul>
      </SortableContext>
    </DndContext>
  )
}
