import { addDays, daysBetween, formatTime } from '@/lib/date'
import type { DateStr, Task } from '@/types/entities'

/**
 * The Today Engine's rules (M19) — pure, deterministic, and explainable.
 *
 * Nothing here ranks. *Which* task comes first is the Next Action rule in
 * `dashboardStats` (`compareForNextAction`), already tested and already what
 * the Dashboard shows; this module answers the questions that rule does not:
 * why a task is on today's page, how late it is, how the day is going, and how
 * much work is planned. Every answer is a sentence built from fields the task
 * already has, so any line on the Today page can be explained by pointing at a
 * row.
 *
 * No model, no score, no clock: `today` is always passed in.
 */

// -------------------------------------------------------------------- reasons

/** How many whole days late an open task is, or `null` when it is not late. */
export function daysLate(task: Task, today: DateStr): number | null {
  if (task.status !== 'todo' || task.dueDate === null || task.dueDate >= today) return null
  return daysBetween(task.dueDate, today)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Why a task is worth attention today, in words.
 *
 * Built in the order the Next Action rule weighs things — time first, then
 * priority, then the project it belongs to — so the reason reads as the rule's
 * own justification rather than a separate opinion. Only the signals that are
 * actually present appear: a task with no priority does not say "No priority".
 */
export function reasonFor(task: Task, today: DateStr, projectName: string | null = null): string {
  const parts: string[] = []

  const late = daysLate(task, today)
  if (late !== null) {
    parts.push(`Overdue by ${plural(late, 'day')}`)
  } else if (task.dueDate === today) {
    parts.push(task.dueTime === null ? 'Due today' : `Scheduled ${formatTime(task.dueTime)}`)
  } else if (task.dueDate === addDays(today, 1)) {
    parts.push('Due tomorrow')
  } else if (task.dueDate !== null) {
    parts.push(`Due in ${plural(daysBetween(today, task.dueDate), 'day')}`)
  } else {
    parts.push('No due date')
  }

  if (task.priority === 'urgent') parts.push('Urgent priority')
  else if (task.priority === 'high') parts.push('High priority')

  if (projectName !== null) parts.push(projectName)

  return parts.join(' · ')
}

// ------------------------------------------------------------------- progress

export interface TodayProgress {
  /** Tasks completed today. */
  tasksDone: number
  /**
   * Today's task load: what was completed today plus what is still due today.
   * Overdue work is not counted — it belongs to earlier days, and folding it in
   * would make "4 / 7" mean something different every morning.
   */
  tasksPlanned: number
  /** Minutes of focus finished today, by the Analytics screen's own definition. */
  focusMinutes: number
  habitsDone: number
  habitsScheduled: number
}

export function progressFor(input: {
  completedToday: number
  openDueToday: number
  focusMinutes: number
  habitsDone: number
  habitsScheduled: number
}): TodayProgress {
  return {
    tasksDone: input.completedToday,
    tasksPlanned: input.completedToday + input.openDueToday,
    focusMinutes: input.focusMinutes,
    habitsDone: input.habitsDone,
    habitsScheduled: input.habitsScheduled,
  }
}

// ---------------------------------------------------------------- time budget

/**
 * Whether today's planned work fits the time available.
 *
 * `unknown` whenever the available time is — which, in M19, is always: Vaultwork
 * records no working hours and a timed task has a start but no duration, so
 * there is nothing honest to subtract. The comparison exists, and is tested, so
 * that a future source of real availability (working hours, a connected
 * calendar) plugs in without the Today page ever having shown a made-up number.
 */
export type TimeFit = 'fits' | 'over' | 'unknown'

export interface TimeBudget {
  /** Open tasks due today or earlier — today's plate. */
  plannedTasks: number
  /** Of those, how many carry an estimate the user entered. */
  estimatedTasks: number
  unestimatedTasks: number
  /** The sum of the estimates that exist. Never includes a guessed duration. */
  estimatedMinutes: number
  /** `null` until something real says how much time the day has. */
  availableMinutes: number | null
  fit: TimeFit
}

export function fitOf(estimatedMinutes: number, availableMinutes: number | null): TimeFit {
  if (availableMinutes === null) return 'unknown'
  return estimatedMinutes <= availableMinutes ? 'fits' : 'over'
}

/**
 * What today's open work adds up to — using only the estimates that exist.
 *
 * An unestimated task is counted as unestimated, not as zero minutes and not as
 * an average: "3 of 5 tasks estimated" is the truth, and a total that quietly
 * treated the other two as free would be a comfortable lie.
 */
export function timeBudgetFor(
  planned: readonly Task[],
  availableMinutes: number | null = null,
): TimeBudget {
  const open = planned.filter((task) => task.status === 'todo')
  const estimated = open.filter((task) => task.estimateMin !== null && task.estimateMin > 0)
  const estimatedMinutes = estimated.reduce((sum, task) => sum + (task.estimateMin ?? 0), 0)
  return {
    plannedTasks: open.length,
    estimatedTasks: estimated.length,
    unestimatedTasks: open.length - estimated.length,
    estimatedMinutes,
    availableMinutes,
    fit: fitOf(estimatedMinutes, availableMinutes),
  }
}
