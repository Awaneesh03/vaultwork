import { Link } from 'react-router-dom'
import { ROUTES } from '@/app/navigation'
import { cn } from '@/lib/cn'
import { GOAL_HEALTH_CLASSES, GOAL_HEALTH_LABELS } from '@/features/goals/goalAppearance'
import { GoalProgress } from '@/features/goals/components/GoalProgress'
import type { GoalDashboardSummary } from '@/services'

/**
 * Active goals, on the Dashboard.
 *
 * Every figure comes from `goalQueryService.getGoalDashboard` — which is built
 * on `getGoalsView`, the same call the Goals screen makes — so the two cannot
 * report different progress. This file contains no goal arithmetic at all.
 *
 * Goals are deliberately their own section and never merge into the task Next
 * Action: "become strong in DSA" is not a candidate answer to "what should I
 * work on right now", and letting it become one would make that recommendation
 * useless. The card is a status readout, not a to-do list.
 */

export function DashboardGoals({ summary }: { summary: GoalDashboardSummary }) {
  const hidden = summary.activeCount - summary.goals.length

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3.5 pb-1.5 pt-2.5">
        <span
          className="tabular text-title font-semibold text-ink"
          aria-label={`${summary.activeCount} active goals`}
        >
          {summary.activeCount}
        </span>
        <span className="text-meta text-ink-3">
          {summary.activeCount === 1 ? 'goal in progress' : 'goals in progress'}
        </span>
        {summary.overdueCount > 0 ? (
          <span className="rounded-sm bg-danger-soft px-1.5 py-px text-micro text-danger">
            {summary.overdueCount} overdue
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col">
        {summary.goals.map((goal) => (
          <li key={goal.id} className="flex flex-col gap-1 px-3.5 py-1.5">
            <div className="flex items-baseline gap-2">
              <Link
                to={`${ROUTES.goals}?goal=${goal.id}`}
                className="min-w-0 flex-1 truncate text-body text-ink-2 hover:text-accent"
              >
                {goal.title}
              </Link>
              <span
                className={cn(
                  'shrink-0 rounded-sm px-1.5 py-px text-micro',
                  GOAL_HEALTH_CLASSES[goal.health],
                )}
              >
                {GOAL_HEALTH_LABELS[goal.health]}
              </span>
              <span className="tabular shrink-0 text-meta text-ink-3">
                {goal.progress.percent}%
              </span>
            </div>
            <GoalProgress
              label={`${goal.title} progress`}
              progress={goal.progress}
              tone={goal.basis === 'none' ? 'muted' : 'accent'}
              className="h-1"
            />
          </li>
        ))}
      </ul>

      {summary.goals.length === 0 ? (
        <p className="px-3.5 pb-2.5 pt-1 text-body text-ink-3">
          No active goals. A goal is an outcome you are working towards.
        </p>
      ) : null}

      {hidden > 0 ? (
        <Link to={ROUTES.goals} className="px-3.5 py-1.5 text-meta text-ink-3 hover:text-accent">
          {hidden} more
        </Link>
      ) : null}
    </div>
  )
}
