import type { ReactNode } from 'react'
import { Check, Clock, ListTree, Pencil, Timer, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDayLabel, formatEstimate, formatTime } from '@/lib/date'
import type { DateStr, Project, Tag, Task } from '@/types/entities'
import { PRIORITY_LABELS } from '../priority'
import { PriorityDot } from './PriorityDot'

/**
 * One task.
 *
 * Purely presentational: it takes rows and callbacks, holds no state and calls
 * no hook. That keeps it cheap to render inside a long list, testable without a
 * database, and reusable by every one of the six views.
 *
 * The row height comes from `--row-height`, which is what the density setting
 * moves — so compact mode is a token change rather than a second component.
 */

export interface TaskRowProps {
  task: Task
  /** Every live tag; the row picks out the ones it needs. */
  tags: Tag[]
  projects: Project[]
  today: DateStr
  progress?: { done: number; total: number } | undefined
  selected?: boolean
  /** True while this row is being dragged, so it can dim. */
  dragging?: boolean
  /** Hides the due date, for views where every row shares one. */
  hideDueDate?: boolean
  /** Hides the project name, for views where every row shares one. */
  hideProject?: boolean
  onToggle: () => void
  onOpen: () => void
  onDelete: () => void
  onSelect?: () => void
  /** The drag grip, supplied by the sortable wrapper. */
  handle?: ReactNode
}

function DueDate({ task, today }: { task: Task; today: DateStr }) {
  if (!task.dueDate) return null

  const overdue = task.status === 'todo' && task.dueDate < today
  const isToday = task.dueDate === today

  return (
    <span className={cn('tabular', overdue ? 'text-danger' : isToday ? 'text-warn' : 'text-ink-3')}>
      {formatDayLabel(task.dueDate, today)}
    </span>
  )
}

export function TaskRow({
  task,
  tags,
  projects,
  today,
  progress,
  selected = false,
  dragging = false,
  hideDueDate = false,
  hideProject = false,
  onToggle,
  onOpen,
  onDelete,
  onSelect,
  handle,
}: TaskRowProps) {
  const done = task.status === 'done'
  const taskTags = tags.filter((tag) => task.tagIds.includes(tag.id))
  const project = hideProject
    ? null
    : (projects.find((entry) => entry.id === task.projectId) ?? null)

  const hasMeta =
    (!hideDueDate && task.dueDate !== null) ||
    task.dueTime !== null ||
    task.estimateMin !== null ||
    project !== null ||
    taskTags.length > 0 ||
    (progress?.total ?? 0) > 0

  return (
    <div
      data-task-id={task.id}
      data-selected={selected || undefined}
      onMouseDown={onSelect}
      className={cn(
        'group/row relative flex items-start gap-2.5 rounded-md px-2 py-1.5 sm:px-2.5',
        'min-h-[var(--row-height)] transition-colors duration-[var(--duration-fast)]',
        // A left edge, only for the two priorities that warrant shouting.
        'before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full',
        task.priority === 'urgent' && !done
          ? 'before:bg-priority-urgent'
          : task.priority === 'high' && !done
            ? 'before:bg-priority-high'
            : 'before:bg-transparent',
        selected
          ? [
              'bg-accent-soft',
              // The keyboard cursor. A tint alone is a shade of grey to anyone
              // not looking for it, and this list is walked with j/k.
              'after:absolute after:inset-y-0 after:right-0 after:w-[2px]',
              'after:rounded-l-full after:bg-accent',
            ]
          : 'hover:bg-sunken',
        // A dragged row lifts rather than only fading, so the gap it left and
        // the thing being moved are both legible at once.
        dragging && 'scale-[0.99] opacity-45 shadow-[var(--shadow-lg)]',
      )}
    >
      {handle}

      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={onToggle}
        className={cn(
          'mt-[3px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border',
          'transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)]',
          // Completing is the one interaction worth a flourish: the mark scales
          // in on the spring curve. It is 120ms, so it reads as feedback rather
          // than as an animation you have to wait through.
          'active:scale-90',
          done
            ? 'border-ok bg-ok text-white'
            : 'border-line-strong bg-transparent text-transparent hover:border-accent hover:text-accent/40',
        )}
      >
        <Check
          size={11}
          strokeWidth={3}
          aria-hidden
          className={cn(
            'transition-transform duration-[var(--duration-fast)]',
            done ? 'scale-100 ease-[var(--ease-spring)]' : 'scale-75',
          )}
        />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <PriorityDot priority={task.priority} />
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              'min-w-0 truncate text-left text-strong leading-snug',
              'transition-colors duration-[var(--duration-base)]',
              done ? 'text-ink-3 line-through decoration-ink-3/40' : 'text-ink hover:text-accent',
            )}
            title={task.title}
          >
            {task.title}
          </button>
        </div>

        {hasMeta ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-ink-3">
            {hideDueDate ? null : <DueDate task={task} today={today} />}

            {task.dueTime ? (
              <span className="tabular inline-flex items-center gap-1">
                <Clock size={11} aria-hidden />
                {formatTime(task.dueTime)}
              </span>
            ) : null}

            {task.estimateMin !== null ? (
              <span className="tabular inline-flex items-center gap-1">
                <Timer size={11} aria-hidden />
                {formatEstimate(task.estimateMin)}
              </span>
            ) : null}

            {progress && progress.total > 0 ? (
              <span className="tabular inline-flex items-center gap-1">
                <ListTree size={11} aria-hidden />
                {progress.done}/{progress.total}
              </span>
            ) : null}

            {project ? <span className="truncate text-ink-2">{project.name}</span> : null}

            {taskTags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-sm bg-sunken px-1.5 py-px text-micro text-ink-2"
              >
                #{tag.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Actions stay hidden until the row is hovered, focused or selected —
          eight icons per row is a control panel, not a task list. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity',
          'group-hover/row:opacity-100 focus-within:opacity-100',
          selected && 'opacity-100',
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Edit ${task.title}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-elevated hover:text-ink"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${task.title}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <span className="sr-only">{PRIORITY_LABELS[task.priority]}</span>
    </div>
  )
}
