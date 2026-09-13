import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/date'
import { projectColorVar } from '@/features/projects/projectAppearance'
import { PRIORITY_LABELS } from '@/features/tasks/priority'
import type { DateStr, Project, Task } from '@/types/entities'

/**
 * One task inside a calendar cell.
 *
 * Compact by necessity — a month cell is about 120px wide — but never at the
 * cost of meaning. Three things are communicated without relying on colour:
 * completion is a line through the title *and* a tick, overdue is a "late"
 * word in the accessible name and a left bar, and priority is spelled out in
 * that name rather than left to the dot.
 *
 * It is a `<button>` first and a drag source second. Clicking opens the task in
 * the existing detail panel; dragging is an enhancement on top, and everything
 * the chip can do by drag can also be done from that panel.
 */

export interface CalendarTaskChipProps {
  task: Task
  today: DateStr
  projects: Project[]
  /** Off in the time grid, where the column already states the time. */
  showTime?: boolean
  compact?: boolean
  draggable?: boolean
  onOpen: (task: Task) => void
  onToggle: (task: Task) => void
  className?: string
  style?: React.CSSProperties
}

export function CalendarTaskChip({
  task,
  today,
  projects,
  showTime = true,
  compact = false,
  draggable = true,
  onOpen,
  onToggle,
  className,
  style,
}: CalendarTaskChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !draggable,
  })

  const done = task.status === 'done'
  const overdue = !done && task.dueDate !== null && task.dueDate < today
  const project = projects.find((entry) => entry.id === task.projectId) ?? null

  // Everything a screen reader needs, in one sentence, with no colour in it.
  const label = [
    task.title,
    task.dueTime ? `at ${formatTime(task.dueTime)}` : 'all day',
    task.priority === 'none' ? null : PRIORITY_LABELS[task.priority],
    project ? `in ${project.name}` : null,
    done ? 'completed' : overdue ? 'overdue' : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, transform: CSS.Translate.toString(transform) }}
      className={cn(
        'group/chip relative flex min-w-0 items-center gap-1 rounded border px-1 text-left',
        'transition-colors duration-[var(--duration-fast)]',
        compact ? 'h-[17px]' : 'min-h-[19px] py-px',
        done
          ? 'border-line bg-sunken text-ink-3'
          : overdue
            ? 'border-danger/50 bg-danger-soft text-ink'
            : 'border-line bg-elevated text-ink hover:border-accent-line',
        isDragging && 'z-20 opacity-60 shadow-lg',
        className,
      )}
    >
      {/* A colour flag for the project, never the only carrier of meaning. */}
      {project ? (
        <span
          aria-hidden
          className="h-2.5 w-[2px] shrink-0 rounded-full"
          style={{ backgroundColor: projectColorVar(project.color) }}
        />
      ) : null}

      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={(event) => {
          event.stopPropagation()
          onToggle(task)
        }}
        className={cn(
          'grid h-[11px] w-[11px] shrink-0 place-items-center rounded-full border',
          done
            ? 'border-ok bg-ok text-white'
            : 'border-line-strong text-transparent hover:border-accent',
        )}
      >
        <Check size={7} strokeWidth={4} aria-hidden />
      </button>

      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={label}
        title={label}
        onClick={() => onOpen(task)}
        className="min-w-0 flex-1 cursor-pointer truncate text-micro leading-tight"
      >
        {showTime && task.dueTime ? (
          <span className="tabular mr-1 text-ink-3">{formatTime(task.dueTime)}</span>
        ) : null}
        <span className={cn(done && 'line-through decoration-ink-3/60')}>{task.title}</span>
      </button>
    </div>
  )
}
