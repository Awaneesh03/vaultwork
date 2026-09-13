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
import type { HabitListItem } from '@/services'
import type { Id } from '@/types/entities'
import { HabitRow } from './HabitRow'

/**
 * A reorderable list of habits.
 *
 * The same two properties `TaskList` and `ProjectList` are built around, using
 * the same machinery rather than a third implementation: the grip is a real
 * button that space picks up and the arrows move, with spoken announcements;
 * and one drop writes one row, because the service turns the indices into a
 * single midpoint `sortOrder`.
 */

export interface HabitListProps {
  items: HabitListItem[]
  selectedHabitId: Id | null
  /** Off for the archive, where a manual order means nothing. */
  sortable: boolean
  onMove: (orderedIds: Id[], fromIndex: number, toIndex: number) => void
  onToggle: (id: Id) => void
  onOpen: (id: Id) => void
  onEdit: (id: Id) => void
  onArchive: (id: Id) => void
  onDelete: (id: Id) => void
  onSelect: (id: Id) => void
}

function SortableRow({
  enabled,
  item,
  ...rest
}: { enabled: boolean } & Omit<Parameters<typeof HabitRow>[0], 'handle' | 'dragging'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.habit.id,
    disabled: !enabled,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
      className={cn('list-none', isDragging && 'relative z-10')}
    >
      <HabitRow
        item={item}
        dragging={isDragging}
        handle={
          enabled ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${item.habit.name}`}
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

export function HabitList({
  items,
  selectedHabitId,
  sortable,
  onMove,
  onToggle,
  onOpen,
  onEdit,
  onArchive,
  onDelete,
  onSelect,
}: HabitListProps) {
  const [dragging, setDragging] = useState(false)
  const ids = useMemo(() => items.map((item) => item.habit.id), [items])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const index = ids.indexOf(String(active.id))
        const name = items[index]?.habit.name
        return name ? `Picked up ${name}, position ${index + 1} of ${ids.length}.` : undefined
      },
      onDragOver: ({ active, over }) => {
        if (!over) return undefined
        const name = items[ids.indexOf(String(active.id))]?.habit.name
        const to = ids.indexOf(String(over.id)) + 1
        return name ? `${name} is now at position ${to} of ${ids.length}.` : undefined
      },
      onDragEnd: ({ active, over }) => {
        const name = items[ids.indexOf(String(active.id))]?.habit.name
        if (!name) return undefined
        if (!over) return `${name} was returned to its position.`
        return `${name} dropped at position ${ids.indexOf(String(over.id)) + 1}.`
      },
      onDragCancel: ({ active }) => {
        const name = items[ids.indexOf(String(active.id))]?.habit.name
        return name ? `Reordering cancelled. ${name} is back where it was.` : undefined
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
      key={item.habit.id}
      item={item}
      enabled={sortable}
      selected={item.habit.id === selectedHabitId}
      onToggle={() => onToggle(item.habit.id)}
      onOpen={() => onOpen(item.habit.id)}
      onEdit={() => onEdit(item.habit.id)}
      onArchive={() => onArchive(item.habit.id)}
      onDelete={() => onDelete(item.habit.id)}
      onSelect={() => onSelect(item.habit.id)}
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
