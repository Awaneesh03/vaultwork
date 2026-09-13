import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/app/navigation'
import { cn } from '@/lib/cn'
import { projectColorVar } from '@/features/projects/projectAppearance'
import type { TodayHabitSummary } from '@/services'
import type { Id } from '@/types/entities'

/**
 * Today's habits, on the Dashboard.
 *
 * Every figure comes from `habitQueryService.getTodayHabits` — the same call
 * the Habits screen makes — so the two cannot report different counts. This
 * file contains no schedule logic at all.
 *
 * Habits are deliberately their own section and never merge into the task Next
 * Action: "drink water" is not a candidate answer to "what should I work on",
 * and letting it become one would make that recommendation useless.
 */
/** How many rows fit on the card. A layout decision, so it lives here. */
const PREVIEW = 5

export function TodayHabits({
  summary,
  limit = PREVIEW,
  onToggle,
}: {
  summary: TodayHabitSummary
  limit?: number
  onToggle: (habitId: Id) => void
}) {
  const shown = summary.habits.slice(0, limit)
  const hidden = summary.habits.length - shown.length

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3.5 pb-1 pt-2.5">
        <span
          className="tabular text-title font-semibold text-ink"
          aria-label={`${summary.completed} of ${summary.scheduled} habits complete today`}
        >
          {summary.completed} / {summary.scheduled}
        </span>
        <span className="text-meta text-ink-3">
          {summary.remaining === 0 ? 'all done' : `${summary.remaining} to go`}
        </span>
        <span className="flex-1" />
        <div
          className="h-1.5 w-[64px] overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Today's habit completion"
          aria-valuenow={summary.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${summary.percent}%`}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-[var(--duration-base)]"
            style={{ width: `${summary.percent}%` }}
          />
        </div>
      </div>

      <ul className="flex flex-col">
        {shown.map((entry) => (
          <li key={entry.habitId} className="flex items-center gap-2 px-3.5 py-1">
            <button
              type="button"
              role="checkbox"
              aria-checked={entry.completed}
              aria-label={
                entry.completed
                  ? `Undo ${entry.name} for today`
                  : `Complete ${entry.name} for today`
              }
              onClick={() => onToggle(entry.habitId)}
              className={cn(
                'grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border',
                'transition-colors duration-[var(--duration-fast)]',
                entry.completed
                  ? 'border-transparent text-accent-ink'
                  : 'border-line-strong text-transparent hover:border-accent',
              )}
              style={
                entry.completed ? { backgroundColor: projectColorVar(entry.color) } : undefined
              }
            >
              <Check size={9} strokeWidth={3.5} aria-hidden />
            </button>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-body',
                entry.completed ? 'text-ink-3 line-through decoration-ink-3/50' : 'text-ink-2',
              )}
            >
              {entry.name}
            </span>
          </li>
        ))}
      </ul>

      {hidden > 0 ? (
        <Link to={ROUTES.habits} className="px-3.5 py-1.5 text-meta text-ink-3 hover:text-accent">
          {hidden} more
        </Link>
      ) : null}
    </div>
  )
}
