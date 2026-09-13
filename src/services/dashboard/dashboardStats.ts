import { toDateStr } from '@/lib/date'
import type { AppEvent, DateStr, Task, Timestamp } from '@/types/entities'
import { PRIORITY_RANK } from '../tasks/taskFilters'

/**
 * Everything the Dashboard decides, as pure functions.
 *
 * Nothing here touches a repository, a clock or a component, so every rule the
 * Dashboard is actually built on — which task comes next, what counts as
 * "completed today", how an event reads in English — is testable against a
 * plain array with a pinned date. The query service reads rows and runs them
 * through these.
 *
 * The Dashboard invents no data of its own. Every number below is derived from
 * tasks, projects and events that already exist, which is why the screen cannot
 * drift from the lists it summarises.
 */

// ------------------------------------------------------------------ greeting

export const GREETING_KEYS = ['lateNight', 'morning', 'afternoon', 'evening'] as const
export type GreetingKey = (typeof GREETING_KEYS)[number]

/**
 * The greeting for a local hour, 0–23.
 *
 * A key rather than a string, so the boundaries are testable without asserting
 * on prose. Derived from the clock port's own instant — never hard-coded, and
 * never read from `Date.now()` inside a component.
 */
export function greetingFor(hour: number): GreetingKey {
  if (hour < 5) return 'lateNight'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

// ------------------------------------------------------------- completed today

/**
 * The local calendar day an instant falls on.
 *
 * `completedAt` is an *instant* (epoch milliseconds); "today" is a local
 * calendar day. Converting through `toDateStr` — which reads local getters and
 * never `toISOString()` — is what stops a task completed at 11pm in UTC+5:30
 * counting as yesterday's, and it is the same conversion the Completed view's
 * `completedWithin` filter makes.
 */
export function completedOn(task: Task): DateStr | null {
  if (task.status !== 'done' || task.completedAt === null) return null
  return toDateStr(new Date(task.completedAt))
}

/** Tasks finished on a given local day. */
export function completedOnDay(tasks: Task[], day: DateStr): Task[] {
  return tasks.filter((task) => completedOn(task) === day)
}

// ---------------------------------------------------------------- next action

/**
 * Which bucket a task falls in. The bucket dominates every other criterion:
 * an urgent task due next month must not outrank a low-priority one that is
 * already late, because "what should I do next" is a question about time first
 * and importance second.
 */
export const NEXT_ACTION_BUCKETS = ['overdue', 'today', 'scheduled', 'undated'] as const
export type NextActionBucket = (typeof NEXT_ACTION_BUCKETS)[number]

export function bucketFor(task: Task, today: DateStr): NextActionBucket {
  if (task.dueDate === null) return 'undated'
  if (task.dueDate < today) return 'overdue'
  if (task.dueDate === today) return 'today'
  return 'scheduled'
}

const BUCKET_RANK: Record<NextActionBucket, number> = {
  overdue: 0,
  today: 1,
  scheduled: 2,
  undated: 3,
}

/**
 * The Next Action rule, in full. No scoring, no weights, no model — a fixed
 * list of comparisons applied in order, so the same rows always produce the
 * same answer and any selection can be explained by pointing at one line:
 *
 *   1. bucket        overdue, then due today, then dated, then undated
 *   2. priority      urgent → high → medium → low → none
 *   3. due date      earlier first (only separates within the dated buckets)
 *   4. due time      earlier first; a timed task beats an untimed one
 *   5. project       filed work beats unfiled, all else equal
 *   6. sortOrder     the user's own manual ordering
 *   7. createdAt     older first
 *   8. id            a total order, so the result can never be arbitrary
 *
 * Step 8 is what makes this deterministic rather than merely consistent: with
 * it, no two distinct tasks can ever compare equal, so the winner does not
 * depend on the order the database happened to return rows in.
 */
export function compareForNextAction(a: Task, b: Task, today: DateStr): number {
  const bucket = BUCKET_RANK[bucketFor(a, today)] - BUCKET_RANK[bucketFor(b, today)]
  if (bucket !== 0) return bucket

  const priority = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
  if (priority !== 0) return priority

  // Nulls cannot reach here in a way that matters: undated tasks share a
  // bucket, so both sides are null together.
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }

  if (a.dueTime !== b.dueTime) {
    if (a.dueTime === null) return 1
    if (b.dueTime === null) return -1
    return a.dueTime < b.dueTime ? -1 : 1
  }

  const aFiled = a.projectId !== null
  const bFiled = b.projectId !== null
  if (aFiled !== bFiled) return aFiled ? -1 : 1

  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The single task to work on next, or `null` when there is nothing open.
 *
 * Completed tasks are excluded here; deleted ones and recurrence templates
 * never reach this function, because every caller reads through
 * `taskRepo.listLive()`, which filters both.
 */
export function selectNextAction(tasks: Task[], today: DateStr): Task | null {
  const open = tasks.filter((task) => task.status === 'todo')
  if (open.length === 0) return null
  return open.reduce((best, task) =>
    compareForNextAction(task, best, today) < 0 ? task : best,
  )
}

/** The open tasks in the order the Next Action rule ranks them. */
export function rankForNextAction(tasks: Task[], today: DateStr): Task[] {
  return tasks
    .filter((task) => task.status === 'todo')
    .sort((a, b) => compareForNextAction(a, b, today))
}

// ------------------------------------------------------------------- headline

export interface DashboardSummary {
  /** Every task still to do, dated or not. */
  open: number
  /** Open tasks due on today's local date. Overdue is counted separately. */
  dueToday: number
  overdue: number
  /** Tasks whose `completedAt` falls on today's local date. */
  completedToday: number
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/**
 * One sentence describing the day.
 *
 * Deliberately flat reporting rather than encouragement: this is a tool, and a
 * screen that congratulates you every morning stops being read.
 */
export function headlineFor(summary: DashboardSummary): string {
  const parts: string[] = []

  if (summary.dueToday > 0) {
    parts.push(`${summary.dueToday} ${plural(summary.dueToday, 'task', 'tasks')} due today`)
  }
  if (summary.overdue > 0) {
    parts.push(`${summary.overdue} overdue`)
  }

  if (parts.length > 0) return `You have ${parts.join(' and ')}.`

  if (summary.completedToday > 0) {
    const done = summary.completedToday
    return `Nothing due today. ${done} ${plural(done, 'task', 'tasks')} finished so far.`
  }
  if (summary.open > 0) {
    return `Nothing due today. ${summary.open} open ${plural(summary.open, 'task', 'tasks')} without a date.`
  }
  return 'Nothing due today.'
}

// ------------------------------------------------------------------- activity

export interface ActivityEntry {
  id: string
  at: Timestamp
  type: string
  /** "Completed Study Java" — already resolved against the row it names. */
  label: string
  entityType: string
  entityId: string | null
  /** Where the change came from: ui, quickadd, palette, message… */
  source: string
  /** Set when the entry points at something still openable. */
  href: string | null
}

/** The verb each event type reads as. Unknown types fall back to the raw type. */
const VERBS: Record<string, string> = {
  'task.created': 'Added',
  'task.updated': 'Edited',
  'task.completed': 'Completed',
  'task.uncompleted': 'Reopened',
  'task.deleted': 'Deleted',
  'task.restored': 'Restored',
  'task.rescheduled': 'Rescheduled',
  'task.reordered': 'Reordered',
  'subtask.created': 'Added subtask',
  'subtask.completed': 'Checked',
  'subtask.uncompleted': 'Unchecked',
  'subtask.deleted': 'Deleted subtask',
  'subtask.restored': 'Restored subtask',
  'project.created': 'Created project',
  'project.updated': 'Updated project',
  'project.archived': 'Archived project',
  'project.restored': 'Restored project',
  'project.deleted': 'Deleted project',
  'project.reordered': 'Reordered project',
  'tag.created': 'Created tag',
  'tag.updated': 'Renamed tag',
  'tag.deleted': 'Deleted tag',
  'tag.restored': 'Restored tag',
  'app.seeded': 'Seeded the database',
}

/**
 * The name an event refers to.
 *
 * Some events carry it on the payload (`task.completed` records the title it
 * completed, so history stays readable after the row is gone); most do not, and
 * the caller resolves the id against the rows it already holds. The payload is
 * preferred because it is what was true *at the time*.
 */
export function eventSubject(event: AppEvent, resolved: string | null): string | null {
  const fromPayload = event.payload?.['title'] ?? event.payload?.['name']
  if (typeof fromPayload === 'string' && fromPayload.length > 0) return fromPayload
  return resolved
}

/** "Completed Study Java", or just "Completed" when the subject is unknown. */
export function describeEvent(event: AppEvent, resolved: string | null = null): string {
  const verb = VERBS[event.type] ?? event.type
  const subject = eventSubject(event, resolved)
  return subject === null ? verb : `${verb} ${subject}`
}
