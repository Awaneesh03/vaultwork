import { Check, Clock, Sparkles, Timer, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { formatDayLabel, formatEstimate, formatTime } from '@/lib/date'
import { PRIORITY_LABELS } from '@/features/tasks/priority'
import { PriorityDot } from '@/features/tasks/components/PriorityDot'
import type { DateStr, Project, Task } from '@/types/entities'

/**
 * What to work on next — one task, chosen by a rule you can read.
 *
 * The selection happens in `dashboardStats.selectNextAction`, not here: this
 * component is handed a task and renders it. That is what keeps "which task?"
 * testable without a DOM, and what stops the answer depending on how the screen
 * happens to be laid out.
 *
 * It is deliberately *not* a `TaskRow`. A row is one of many in a list, sized
 * for scanning; this is a single decision, so it earns a larger presentation
 * and explicit buttons instead of hover-revealed icons. Its actions still go
 * through the same command intents every other surface uses.
 */

export function NextAction({
  task,
  today,
  projects,
  onOpen,
  onComplete,
  onSchedule,
  onCapture,
}: {
  task: Task | null
  today: DateStr
  projects: Project[]
  onOpen: (task: Task) => void
  onComplete: (task: Task) => void
  onSchedule: (task: Task) => void
  /** Focuses quick add — the only useful thing to offer when nothing is open. */
  onCapture: () => void
}) {
  if (!task) {
    return (
      <section
        aria-label="Next action"
        className="flex flex-col gap-2 panel p-5 shadow-[var(--shadow-sm)]"
      >
        <span className="t-eyebrow flex items-center gap-1.5 text-ink-3">
          <Sparkles size={12} aria-hidden />
          Next action
        </span>
        <p className="text-title font-medium text-ink">You&rsquo;re clear.</p>
        <p className="t-meta text-ink-3">
          Nothing open. Capture the next thing before it turns into a memory test.
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={onCapture}>
            Capture a task
          </Button>
        </div>
      </section>
    )
  }

  const project = projects.find((entry) => entry.id === task.projectId) ?? null
  const overdue = task.dueDate !== null && task.dueDate < today
  const dueToday = task.dueDate === today

  return (
    <section
      aria-label="Next action"
      className={cn(
        'relative flex flex-col gap-3 overflow-hidden rounded-lg border border-accent-line/70',
        'bg-surface p-5 pl-[21px] shadow-[var(--shadow-sm)]',
      )}
    >
      {/*
        A violet rail down the leading edge. This is the one decision the screen
        exists to present, so it gets the only accent edge on the page — which
        only works because nothing else claims one.
      */}
      <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" aria-hidden />

      <span className="t-eyebrow flex items-center gap-1.5 text-accent">
        <Sparkles size={12} aria-hidden />
        Next action
      </span>

      <div className="flex items-start gap-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={false}
          aria-label={`Complete ${task.title}`}
          onClick={() => onComplete(task)}
          className={cn(
            'mt-[3px] grid h-[21px] w-[21px] shrink-0 place-items-center rounded-full border',
            'border-line-strong bg-transparent text-transparent transition-colors',
            'duration-[var(--duration-fast)] hover:border-accent hover:text-accent/40',
          )}
        >
          <Check size={12} strokeWidth={3} aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen(task)}
            title={task.title}
            className="max-w-full truncate text-left text-title leading-snug font-medium text-ink transition-colors hover:text-accent"
          >
            {task.title}
          </button>

          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-ink-3">
            {/* The dot is decorative; the words carry the meaning, so priority
                is never communicated by colour alone. */}
            {task.priority !== 'none' ? (
              <span className="inline-flex items-center gap-1">
                <PriorityDot priority={task.priority} />
                {PRIORITY_LABELS[task.priority]}
              </span>
            ) : null}

            {task.dueDate ? (
              <span
                className={cn(
                  'tabular inline-flex items-center gap-1',
                  overdue ? 'text-danger' : dueToday ? 'text-warn' : 'text-ink-3',
                )}
              >
                {overdue ? (
                  <TriangleAlert size={11} aria-hidden />
                ) : (
                  <Clock size={11} aria-hidden />
                )}
                {formatDayLabel(task.dueDate, today)}
                {task.dueTime ? ` · ${formatTime(task.dueTime)}` : ''}
                {overdue ? ' · overdue' : ''}
              </span>
            ) : (
              <span className="text-ink-3">No due date</span>
            )}

            {task.estimateMin !== null ? (
              <span className="tabular inline-flex items-center gap-1">
                <Timer size={11} aria-hidden />
                {formatEstimate(task.estimateMin)}
              </span>
            ) : null}

            {project ? <span className="truncate text-ink-2">{project.name}</span> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button variant="primary" size="sm" onClick={() => onComplete(task)}>
          Complete
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onOpen(task)}>
          Open
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onSchedule(task)}>
          Reschedule
        </Button>
      </div>
    </section>
  )
}
