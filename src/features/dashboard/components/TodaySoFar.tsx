import { Link } from 'react-router-dom'
import { formatEstimate } from '@/lib/date'
import type { TimeBudget, TodayProgress } from '@/services'

/**
 * How today is going, and what is planned (M19).
 *
 * Every figure here is a count Vaultwork already keeps: tasks completed, focus
 * minutes as Analytics defines them, habits logged, estimates the user typed.
 * Each has its words next to it, so a number is never the only thing a reader
 * gets — and nothing is shown that the data cannot support.
 *
 * The time budget is deliberately partial. Vaultwork does not know your working
 * hours, and a timed task has a start but no length, so there is no honest
 * "available time" to compare against. It says how much estimated work there
 * is, how much of the plan that covers, and that it cannot say whether it fits.
 */

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="tabular text-strong font-medium text-ink">{value}</span>
      <span className="text-meta text-ink-3">{label}</span>
    </div>
  )
}

function budgetSentence(budget: TimeBudget): string {
  if (budget.plannedTasks === 0) return 'Nothing is due today or overdue.'
  if (budget.estimatedTasks === 0) {
    return `None of today's ${budget.plannedTasks} tasks has an estimate, so there is no total to show.`
  }
  const coverage =
    budget.unestimatedTasks === 0
      ? `all ${budget.plannedTasks} tasks`
      : `${budget.estimatedTasks} of ${budget.plannedTasks} tasks`
  return `About ${formatEstimate(budget.estimatedMinutes)} of estimated work, from ${coverage}.`
}

export function TodaySoFar({
  progress,
  budget,
  capturesWaiting,
}: {
  progress: TodayProgress
  budget: TimeBudget
  capturesWaiting: number
}) {
  return (
    <section
      aria-labelledby="today-so-far"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3"
    >
      <h2 id="today-so-far" className="t-eyebrow text-ink-3">
        Today so far
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure
          value={`${progress.tasksDone} / ${progress.tasksPlanned}`}
          label="tasks done today"
        />
        <Figure value={`${progress.focusMinutes} min`} label="focused today" />
        <Figure
          value={`${progress.habitsDone} / ${progress.habitsScheduled}`}
          label="habits logged"
        />
        <div className="flex min-w-0 flex-col">
          <span className="tabular text-strong font-medium text-ink">{capturesWaiting}</span>
          {capturesWaiting > 0 ? (
            <Link to="/inbox" className="text-meta text-ink-2 underline-offset-2 hover:underline">
              {capturesWaiting === 1 ? 'capture waiting' : 'captures waiting'}
            </Link>
          ) : (
            <span className="text-meta text-ink-3">captures waiting</span>
          )}
        </div>
      </div>

      <p className="text-body text-ink-2">
        {budgetSentence(budget)}
        {budget.plannedTasks > 0 && budget.fit === 'unknown' ? (
          <span className="text-ink-3">
            {' '}
            Vaultwork doesn&apos;t know your working hours yet, so it can&apos;t say whether that
            fits your day.
          </span>
        ) : null}
      </p>
    </section>
  )
}
