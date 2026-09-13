import { formatDayLabel } from '@/lib/date'
import type { GoalHealth, GoalSort } from '@/services'
import type { DateStr } from '@/types/entities'
import type { GoalHorizon, GoalStatus } from '@/types/enums'

/**
 * How a goal's state is put into words and colour.
 *
 * Every state has a *label* as well as a colour, and the components render the
 * label. Colour is the fast path for someone who can use it, never the only
 * path — an overdue goal says "Overdue", it is not merely red.
 */

export const GOAL_HEALTH_LABELS: Record<GoalHealth, string> = {
  completed: 'Complete',
  overdue: 'Overdue',
  'on-track': 'On track',
  'no-deadline': 'No deadline',
}

/** Tailwind classes per health state. Paired with the label above, never alone. */
export const GOAL_HEALTH_CLASSES: Record<GoalHealth, string> = {
  completed: 'bg-accent-soft text-accent',
  overdue: 'bg-danger-soft text-danger',
  'on-track': 'bg-sunken text-ink-2',
  'no-deadline': 'bg-sunken text-ink-3',
}

/**
 * What the model's four statuses are called on screen.
 *
 * `dropped` reads as "Archived": the schema's word is about intent, the user's
 * word is about where it went. Both name the same single field.
 */
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  achieved: 'Complete',
  dropped: 'Archived',
}

export const GOAL_HORIZON_LABELS: Record<GoalHorizon, string> = {
  short: 'Short horizon',
  long: 'Long horizon',
}

/** Says which figure a percentage came from, so a bar is never unexplained. */
export function describeBasis(milestones: number, tasks: number): string {
  if (milestones > 0) return `${milestones} milestone${milestones === 1 ? '' : 's'}`
  if (tasks > 0) return `${tasks} task${tasks === 1 ? '' : 's'}`
  return 'nothing tracked yet'
}

/**
 * The sort options the toolbar offers.
 *
 * Lives here rather than in the service layer because it is presentation: a
 * component may type-import from `@/services` but never value-import, and the
 * labels are a UI concern anyway. `GoalSort` itself stays the service's type,
 * so adding a sort there is a type error here until this list is updated.
 */
export const GOAL_SORT_OPTIONS: { id: GoalSort; label: string }[] = [
  { id: 'manual', label: 'Manual order' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'progress', label: 'Progress' },
  { id: 'created', label: 'Created' },
  { id: 'name', label: 'Name' },
]

/**
 * A goal or milestone deadline, in as few words as remain unambiguous.
 *
 * `formatDayLabel` is M3's shared task formatter and deliberately never prints
 * a year: a task is days or weeks away, so "Sun 2 May" is unambiguous. A goal
 * is routinely a year or more out, where the same string could mean either of
 * two Mays. Rather than change the shared function — every task screen depends
 * on its current output — this adds the year only when the date falls outside
 * the current one.
 */
export function formatGoalDate(date: DateStr, today: DateStr): string {
  const label = formatDayLabel(date, today)
  const sameYear = date.slice(0, 4) === today.slice(0, 4)
  // "Today", "Tomorrow" and bare weekdays are always within a few days, so
  // they never need qualifying.
  return sameYear || /^(Today|Tomorrow|Yesterday)$/.test(label) || !label.includes(' ')
    ? label
    : `${label} ${date.slice(0, 4)}`
}
