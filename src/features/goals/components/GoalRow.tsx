import type { ReactNode } from 'react'
import { Archive, ArchiveRestore, Check, Flag, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { GoalListItem } from '@/services'
import {
  GOAL_HEALTH_CLASSES,
  GOAL_HEALTH_LABELS,
  GOAL_STATUS_LABELS,
  describeBasis,
  formatGoalDate,
} from '../goalAppearance'
import { GoalProgress } from './GoalProgress'

/**
 * One goal.
 *
 * Purely presentational: view model and callbacks in, no state, no hook — the
 * same contract `TaskRow`, `ProjectRow` and `HabitRow` keep.
 *
 * The row answers the three questions a goal raises, in order: *what is the
 * outcome → how far along is it → is it in trouble.* The percentage always
 * comes with the counts it was computed from and the word for what was counted,
 * so "60%" is never a number with no provenance.
 */

export interface GoalRowProps {
  item: GoalListItem
  today: string
  selected?: boolean
  dragging?: boolean
  onOpen: () => void
  onComplete: () => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
  onSelect?: () => void
  /** The drag grip, supplied by the sortable wrapper. */
  handle?: ReactNode
}

export function GoalRow({
  item,
  today,
  selected = false,
  dragging = false,
  onOpen,
  onComplete,
  onEdit,
  onArchive,
  onDelete,
  onSelect,
  handle,
}: GoalRowProps) {
  const { goal, progress, milestones, tasks, health, overdueMilestones } = item
  const completed = goal.status === 'achieved'
  const archived = goal.status === 'dropped'

  return (
    <div
      data-goal-id={goal.id}
      data-selected={selected || undefined}
      onMouseDown={onSelect}
      className={cn(
        'group/row relative flex items-start gap-2.5 rounded-md border px-2 py-2 sm:px-2.5',
        'transition-colors duration-[var(--duration-fast)]',
        selected
          ? 'border-accent-line bg-accent-soft/60'
          : 'border-transparent hover:border-line hover:bg-surface',
        archived && 'opacity-70',
        dragging && 'opacity-40',
      )}
    >
      {handle}

      <button
        type="button"
        role="checkbox"
        aria-checked={completed}
        aria-label={completed ? `Reopen ${goal.title}` : `Complete ${goal.title}`}
        onClick={onComplete}
        className={cn(
          'mt-[2px] grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border',
          'transition-colors duration-[var(--duration-fast)]',
          completed
            ? 'border-transparent bg-accent text-accent-ink'
            : 'border-line-strong text-transparent hover:border-accent hover:text-accent/40',
        )}
      >
        <Check size={12} strokeWidth={3} aria-hidden />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button
            type="button"
            onClick={onOpen}
            title={goal.title}
            className={cn(
              'min-w-0 max-w-full truncate text-left text-strong font-medium leading-snug',
              completed ? 'text-ink-2' : 'text-ink',
              'hover:text-accent',
            )}
          >
            {goal.title}
          </button>

          <span
            className={cn(
              'shrink-0 rounded-sm px-1.5 py-px text-micro',
              GOAL_HEALTH_CLASSES[health],
            )}
          >
            {GOAL_HEALTH_LABELS[health]}
          </span>

          {goal.targetDate !== null && !completed ? (
            <span className="tabular shrink-0 text-meta text-ink-3">
              {formatGoalDate(goal.targetDate, today)}
            </span>
          ) : null}

          {goal.status === 'paused' || archived ? (
            <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-micro text-ink-3">
              {GOAL_STATUS_LABELS[goal.status]}
            </span>
          ) : null}
        </div>

        {goal.why ? <p className="mt-0.5 line-clamp-1 text-meta text-ink-3">{goal.why}</p> : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <GoalProgress
            label={`${goal.title} progress`}
            progress={progress}
            tone={completed || archived ? 'muted' : 'accent'}
            className="w-full max-w-[180px]"
          />

          <span className="tabular whitespace-nowrap text-meta text-ink-3">
            <span className="text-ink-2">{progress.percent}%</span> ·{' '}
            {describeBasis(milestones.total, tasks.total)}
          </span>

          {milestones.total > 0 ? (
            <span
              className="tabular whitespace-nowrap text-meta text-ink-3"
              aria-label={`${milestones.done} of ${milestones.total} milestones complete`}
            >
              {milestones.done}/{milestones.total} done
            </span>
          ) : null}

          {tasks.total > 0 && milestones.total > 0 ? (
            <span
              className="tabular hidden whitespace-nowrap text-meta text-ink-3 sm:inline"
              aria-label={`${tasks.done} of ${tasks.total} related tasks complete`}
            >
              {tasks.done}/{tasks.total} tasks
            </span>
          ) : null}

          {overdueMilestones > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-meta text-danger">
              <Flag size={10} aria-hidden />
              {overdueMilestones} late
            </span>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity',
          'focus-within:opacity-100 group-hover/row:opacity-100',
          selected && 'opacity-100',
        )}
      >
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${goal.title}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-elevated hover:text-ink"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          onClick={onArchive}
          aria-label={archived ? `Restore ${goal.title}` : `Archive ${goal.title}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-elevated hover:text-ink"
        >
          {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${goal.title}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Stated in words as well as in the checkbox's own aria-checked. */}
      <span className="sr-only">
        {completed ? 'Complete' : archived ? 'Archived' : GOAL_HEALTH_LABELS[health]}
        {completed ? '' : `, ${progress.percent} percent`}
      </span>
    </div>
  )
}
