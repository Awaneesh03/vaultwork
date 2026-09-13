import { useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
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
import { Check, GripVertical, Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Id, Subtask } from '@/types/entities'

/**
 * The subtask checklist.
 *
 * Reordering uses the same keyboard-capable dnd-kit setup as the task list, and
 * the same single-row midpoint write. Checking a subtask is deliberately its
 * own fact: it emits `subtask.completed` and never touches the parent task, so
 * a checklist tick can never show up in the tasks-completed chart.
 */

export interface SubtaskListProps {
  subtasks: Subtask[]
  onAdd: (title: string) => void
  onToggle: (subtask: Subtask) => void
  onDelete: (subtask: Subtask) => void
  onMove: (fromIndex: number, toIndex: number) => void
}

function Row({
  subtask,
  onToggle,
  onDelete,
}: {
  subtask: Subtask
  onToggle: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: subtask.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
      className={cn(
        'group/sub flex items-center gap-2 rounded-md px-1 py-1 hover:bg-sunken',
        isDragging && 'relative z-10 opacity-40',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${subtask.title}`}
        className="cursor-grab touch-none rounded p-0.5 text-ink-3 opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/sub:opacity-100 active:cursor-grabbing"
      >
        <GripVertical size={12} aria-hidden />
      </button>

      <button
        type="button"
        role="checkbox"
        aria-checked={subtask.done}
        aria-label={subtask.done ? `Uncheck ${subtask.title}` : `Check ${subtask.title}`}
        onClick={onToggle}
        className={cn(
          'grid h-[15px] w-[15px] shrink-0 place-items-center rounded-sm border transition-colors',
          subtask.done
            ? 'border-ok bg-ok text-white'
            : 'border-line-strong text-transparent hover:border-accent',
        )}
      >
        <Check size={10} strokeWidth={3} aria-hidden />
      </button>

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px]',
          subtask.done ? 'text-ink-3 line-through decoration-ink-3/50' : 'text-ink-2',
        )}
      >
        {subtask.title}
      </span>

      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${subtask.title}`}
        className="rounded p-1 text-ink-3 opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover/sub:opacity-100"
      >
        <X size={12} />
      </button>
    </li>
  )
}

export function SubtaskList({ subtasks, onAdd, onToggle, onDelete, onMove }: SubtaskListProps) {
  const [draft, setDraft] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ids = subtasks.map((subtask) => subtask.id)
  const done = subtasks.filter((subtask) => subtask.done).length

  const submit = () => {
    const title = draft.trim()
    if (title.length === 0) return
    onAdd(title)
    setDraft('')
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onMove(ids.indexOf(String(active.id) as Id), ids.indexOf(String(over.id) as Id))
  }

  return (
    <div className="flex flex-col gap-1">
      {subtasks.length > 0 ? (
        <p className="tabular t-eyebrow text-ink-3">
          Subtasks {done}/{subtasks.length}
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col">
            {subtasks.map((subtask) => (
              <Row
                key={subtask.id}
                subtask={subtask}
                onToggle={() => onToggle(subtask)}
                onDelete={() => onDelete(subtask)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="flex items-center gap-1.5 pl-1">
        <Plus size={13} className="shrink-0 text-ink-3" aria-hidden />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          onBlur={submit}
          placeholder="Add a subtask…"
          aria-label="Add a subtask"
          className="h-7 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3"
        />
      </div>
    </div>
  )
}

/**
 * The create-time variant: there is no task yet, so subtasks are plain strings
 * held by the composer and written after the task itself.
 */
export function DraftSubtaskList({
  titles,
  onChange,
}: {
  titles: string[]
  onChange: (titles: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const title = draft.trim()
    if (title.length === 0) return
    onChange([...titles, title])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col">
        {titles.map((title, index) => (
          <li
            key={`${title}-${index}`}
            className="group/sub flex items-center gap-2 rounded-md px-1 py-1 hover:bg-sunken"
          >
            <span className="h-[15px] w-[15px] shrink-0 rounded-sm border border-line-strong" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{title}</span>
            <button
              type="button"
              onClick={() => onChange(titles.filter((_, i) => i !== index))}
              aria-label={`Remove ${title}`}
              className="rounded p-1 text-ink-3 opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover/sub:opacity-100"
            >
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-1.5 pl-1">
        <Plus size={13} className="shrink-0 text-ink-3" aria-hidden />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          onBlur={submit}
          placeholder="Add a subtask…"
          aria-label="Add a subtask"
          className="h-7 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3"
        />
      </div>
    </div>
  )
}
