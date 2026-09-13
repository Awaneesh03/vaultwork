import { addDays, daysBetween, formatDayLabel, toDateStr } from '@/lib/date'
import type { DateStr, Task } from '@/types/entities'

/**
 * The six views, as pure grouping over a list of tasks.
 *
 * Sections are data rather than JSX so the ordering rules — the part that is
 * actually a decision — can be tested without rendering anything, and so a
 * future Telegram `/today` can render the same structure as text.
 */

export const TASK_VIEW_IDS = ['inbox', 'today', 'upcoming', 'overdue', 'completed', 'all'] as const
export type TaskViewId = (typeof TASK_VIEW_IDS)[number]

export const TASK_VIEW_PATHS: Record<TaskViewId, string> = {
  inbox: '/inbox',
  today: '/today',
  upcoming: '/upcoming',
  overdue: '/overdue',
  completed: '/completed',
  all: '/tasks',
}

export const TASK_VIEW_LABELS: Record<TaskViewId, string> = {
  inbox: 'Inbox',
  today: 'Today',
  upcoming: 'Upcoming',
  overdue: 'Overdue',
  completed: 'Completed',
  all: 'All tasks',
}

export function isTaskViewId(value: string): value is TaskViewId {
  return (TASK_VIEW_IDS as readonly string[]).includes(value)
}

export interface TaskGroup {
  id: string
  label: string
  /** Secondary line: a date, a count, a warning. */
  hint: string | null
  tasks: Task[]
  /** Whether a drag may reorder within this group. */
  sortable: boolean
  /** The day this group represents, if it represents one. */
  date: DateStr | null
  /** Empty groups are rendered in Upcoming (a visible gap is a fillable gap). */
  keepWhenEmpty: boolean
}

const group = (
  id: string,
  label: string,
  tasks: Task[],
  extra: Partial<Omit<TaskGroup, 'id' | 'label' | 'tasks'>> = {},
): TaskGroup => ({
  id,
  label,
  tasks,
  hint: extra.hint ?? null,
  sortable: extra.sortable ?? true,
  date: extra.date ?? null,
  keepWhenEmpty: extra.keepWhenEmpty ?? false,
})

/** Rolling window for Upcoming. The spec's range, with the wider end as default. */
export const UPCOMING_MIN_DAYS = 7
export const UPCOMING_MAX_DAYS = 14
export const DEFAULT_UPCOMING_DAYS = 14

export function clampUpcomingDays(days: number): number {
  return Math.min(UPCOMING_MAX_DAYS, Math.max(UPCOMING_MIN_DAYS, Math.round(days)))
}

/**
 * Today, in the order that matters:
 *
 *   1. Overdue      — what is late outranks what is merely due
 *   2. Scheduled    — by wall-clock time, earliest first
 *   3. Unscheduled  — due today with no time, in manual order
 *
 * Overdue is not sortable by hand: its order is "how late is it", and letting
 * a drag override that would hide the oldest item.
 */
export function groupToday(tasks: Task[], today: DateStr): TaskGroup[] {
  const open = tasks.filter((task) => task.status === 'todo')

  const overdue = open
    .filter((task) => task.dueDate !== null && task.dueDate < today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.sortOrder - b.sortOrder)

  const dueToday = open.filter((task) => task.dueDate === today)

  const scheduled = dueToday
    .filter((task) => task.dueTime !== null)
    .sort((a, b) => (a.dueTime ?? '').localeCompare(b.dueTime ?? '') || a.sortOrder - b.sortOrder)

  const unscheduled = dueToday
    .filter((task) => task.dueTime === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return [
    group('overdue', 'Overdue', overdue, {
      hint: overdue.length > 0 ? oldestHint(overdue, today) : null,
      sortable: false,
    }),
    group('scheduled', 'Scheduled', scheduled, { sortable: false, date: today }),
    group('unscheduled', 'Anytime today', unscheduled, { date: today }),
  ].filter((section) => section.tasks.length > 0)
}

function oldestHint(overdue: Task[], today: DateStr): string {
  const oldest = overdue[0]?.dueDate
  if (!oldest) return ''
  const days = daysBetween(oldest, today)
  if (days <= 0) return ''
  return days === 1 ? 'since yesterday' : `up to ${days} days late`
}

/**
 * Upcoming: one section per day, starting tomorrow. Empty days are kept so the
 * shape of the week is visible — a gap you can see is a gap you can fill.
 */
export function groupUpcoming(
  tasks: Task[],
  today: DateStr,
  days: number = DEFAULT_UPCOMING_DAYS,
): TaskGroup[] {
  const span = clampUpcomingDays(days)
  const open = tasks.filter((task) => task.status === 'todo')

  return Array.from({ length: span }, (_, offset) => {
    const date = addDays(today, offset + 1)
    const forDay = open
      .filter((task) => task.dueDate === date)
      .sort(
        (a, b) =>
          (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || a.sortOrder - b.sortOrder,
      )
    return group(date, formatDayLabel(date, today), forDay, {
      hint: forDay.length > 0 ? `${forDay.length}` : null,
      date,
      keepWhenEmpty: true,
      sortable: false,
    })
  })
}

/** Completed tasks bucketed by the day they were finished, newest day first. */
export function groupCompleted(tasks: Task[], today: DateStr): TaskGroup[] {
  const buckets = new Map<DateStr, Task[]>()

  for (const task of tasks) {
    if (task.status !== 'done') continue
    const at = task.completedAt ?? task.updatedAt
    const day = toDateStr(new Date(at))
    const bucket = buckets.get(day)
    if (bucket) bucket.push(task)
    else buckets.set(day, [task])
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, rows]) =>
      group(
        day,
        formatDayLabel(day, today),
        rows.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)),
        { hint: `${rows.length}`, sortable: false, date: day },
      ),
    )
}

/**
 * A project's tasks: open work first, then what is finished.
 *
 * This lives here rather than in the project service so that every grouping
 * rule in the application is in one file and testable the same way. Completed
 * is never hand-sortable — its order is "most recently finished", and a drag
 * that overrode that would hide what you just did.
 */
export function groupProjectTasks(tasks: Task[], sortable = true): TaskGroup[] {
  const open = tasks.filter((task) => task.status === 'todo')
  const done = tasks
    .filter((task) => task.status === 'done')
    .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))

  return [
    group('open', 'Open', open, { sortable, hint: open.length > 0 ? `${open.length}` : null }),
    group('completed', 'Completed', done, {
      sortable: false,
      hint: done.length > 0 ? `${done.length}` : null,
    }),
  ].filter((section) => section.tasks.length > 0)
}

/** A single unlabelled section — Inbox, Overdue and All Tasks are flat lists. */
export function singleGroup(id: string, tasks: Task[], sortable = true): TaskGroup[] {
  return [group(id, '', tasks, { sortable })]
}

/** Total estimated minutes, for the Today capacity line. */
export function totalEstimate(tasks: Task[]): number {
  return tasks.reduce((sum, task) => sum + (task.estimateMin ?? 0), 0)
}
