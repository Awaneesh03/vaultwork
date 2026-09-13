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
import type { ProjectSummary } from '@/services'
import type { DateStr, Id } from '@/types/entities'
import { ProjectRow } from './ProjectRow'

/**
 * A reorderable list of projects.
 *
 * The same two properties `TaskList` is built around, for the same reasons.
 *
 * **Keyboard support is not an add-on.** dnd-kit's `KeyboardSensor` with
 * `sortableKeyboardCoordinates` makes the grip a real button: space picks a
 * project up, the arrows move it, space drops it, escape cancels — and the
 * announcements below say what happened out loud.
 *
 * **One drop writes one row.** `onMove` reports indices; the service turns them
 * into a single midpoint `sortOrder`, so a drag costs one write and one event
 * instead of N.
 *
 * Dragging is confined to a single section. Reordering the archive is
 * meaningless, and dragging *between* the sections would be an archive
 * disguised as a drag — an action that emits a different event and deserves a
 * button that says so.
 */

export interface ProjectListProps {
  summaries: ProjectSummary[]
  today: DateStr
  selectedProjectId: Id | null
  /** Off for the archive, and whenever a sort other than manual is chosen. */
  sortable: boolean
  onMove: (orderedIds: Id[], fromIndex: number, toIndex: number) => void
  onOpen: (id: Id) => void
  onEdit: (id: Id) => void
  onArchive: (id: Id) => void
  onDelete: (id: Id) => void
  onSelect: (id: Id) => void
}

function SortableRow({
  enabled,
  summary,
  ...rest
}: { enabled: boolean } & Omit<Parameters<typeof ProjectRow>[0], 'handle' | 'dragging'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: summary.project.id,
    disabled: !enabled,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
      className={cn('list-none', isDragging && 'relative z-10')}
    >
      <ProjectRow
        summary={summary}
        dragging={isDragging}
        handle={
          enabled ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${summary.project.name}`}
              className={cn(
                'mt-[5px] -ml-1 cursor-grab rounded p-0.5 text-ink-3 opacity-0 transition-opacity',
                'hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100',
                'touch-none active:cursor-grabbing',
              )}
            >
              <GripVertical size={13} aria-hidden />
            </button>
          ) : (
            <span className="mt-[5px] -ml-1 w-[18px] shrink-0" aria-hidden />
          )
        }
        {...rest}
      />
    </li>
  )
}

export function ProjectList({
  summaries,
  today,
  selectedProjectId,
  sortable,
  onMove,
  onOpen,
  onEdit,
  onArchive,
  onDelete,
  onSelect,
}: ProjectListProps) {
  const [dragging, setDragging] = useState(false)
  const ids = useMemo(() => summaries.map((entry) => entry.project.id), [summaries])

  const sensors = useSensors(
    // A few pixels of slop so clicking a row's title never starts a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const index = ids.indexOf(String(active.id))
        const name = summaries[index]?.project.name
        return name ? `Picked up ${name}, position ${index + 1} of ${ids.length}.` : undefined
      },
      onDragOver: ({ active, over }) => {
        if (!over) return undefined
        const name = summaries[ids.indexOf(String(active.id))]?.project.name
        const to = ids.indexOf(String(over.id)) + 1
        return name ? `${name} is now at position ${to} of ${ids.length}.` : undefined
      },
      onDragEnd: ({ active, over }) => {
        const name = summaries[ids.indexOf(String(active.id))]?.project.name
        if (!name) return undefined
        if (!over) return `${name} was returned to its position.`
        return `${name} dropped at position ${ids.indexOf(String(over.id)) + 1}.`
      },
      onDragCancel: ({ active }) => {
        const name = summaries[ids.indexOf(String(active.id))]?.project.name
        return name ? `Reordering cancelled. ${name} is back where it was.` : undefined
      },
    }),
    [ids, summaries],
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

  const rows = summaries.map((summary) => (
    <SortableRow
      key={summary.project.id}
      summary={summary}
      enabled={sortable}
      today={today}
      selected={summary.project.id === selectedProjectId}
      onOpen={() => onOpen(summary.project.id)}
      onEdit={() => onEdit(summary.project.id)}
      onArchive={() => onArchive(summary.project.id)}
      onDelete={() => onDelete(summary.project.id)}
      onSelect={() => onSelect(summary.project.id)}
    />
  ))

  if (!sortable) {
    return <ul className="flex flex-col gap-0.5">{rows}</ul>
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
        <ul className={cn('flex flex-col gap-0.5', dragging && 'select-none')}>{rows}</ul>
      </SortableContext>
    </DndContext>
  )
}
