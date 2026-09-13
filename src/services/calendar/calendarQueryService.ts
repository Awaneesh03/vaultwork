import { isWeekend, timeToMinutes } from '@/lib/date'
import { platform } from '@/platform'
import { projectRepo, settingsRepo, subtaskRepo, tagRepo, taskRepo } from '@/repositories'
import type { DateStr, Id, Project, Tag, Task, TimeStr } from '@/types/entities'
import {
  DEFAULT_TASK_FILTER,
  buildSearchIndex,
  filterTasks,
  isTaskOverdue,
  type TaskFilter,
  type TaskStatusFilter,
} from '../tasks/taskFilters'
import { monthGrid, periodTitle, visibleRange, weekDates, type CalendarMode } from '@/lib/calendar'

/**
 * The Calendar's view model.
 *
 * Three rules govern this file, and they are the whole of M6's architecture.
 *
 * **The calendar is a view of tasks, not a store of events.** Nothing here is
 * persisted; `CalendarDay` is assembled on every read from the same `Task` rows
 * the six task views render. There is no calendar table, no event model, and no
 * second definition of a task.
 *
 * **It borrows every rule it needs.** Which tasks match comes from M3's
 * `filterTasks`; whether one is late comes from M3's `isTaskOverdue`. If the
 * Overdue view's definition changes, this changes with it — a cross-view test
 * fails if it ever does not.
 *
 * **It reads only what it draws.** One indexed range query covers the visible
 * period, adjacent-month days included, plus one read for undated work. A
 * calendar that scanned the whole task table to render a week would get slower
 * every month the user keeps using it.
 */

/** How a task relates to a calendar date. The three placements, named. */
export type CalendarPlacement = 'timed' | 'allDay' | 'unscheduled'

export function placementOf(task: Task): CalendarPlacement {
  if (task.dueDate === null) return 'unscheduled'
  return task.dueTime === null ? 'allDay' : 'timed'
}

/** One cell. A view model — never written to Dexie. */
export interface CalendarDay {
  date: DateStr
  isToday: boolean
  /** False for the adjacent-month days a month grid draws at its edges. */
  isCurrentMonth: boolean
  isWeekend: boolean
  /** All-day first, then timed by clock time. What a month cell renders. */
  tasks: Task[]
  /** Dated here with no time of day. */
  allDay: Task[]
  /** Dated here with a time, ordered by it. */
  timed: Task[]
  overdueCount: number
  completedCount: number
}

export interface CalendarOptions {
  mode: CalendarMode
  /**
   * The date the period is built around. Omitted means today, resolved from
   * the clock port — so the UI never has to read a clock to open the calendar.
   */
  anchor?: DateStr | undefined
  /** Which tasks to show. Reuses M3's status filter rather than inventing one. */
  status?: TaskStatusFilter | undefined
  /** How many undated tasks to load for the side panel. */
  unscheduledLimit?: number | undefined
}

export interface CalendarData {
  mode: CalendarMode
  anchor: DateStr
  today: DateStr
  weekStartsOn: 0 | 1
  /** What the toolbar shows: "September 2026", "1 – 7 September 2026", … */
  title: string
  from: DateStr
  to: DateStr
  /** Month: one row per week. Week: a single row of seven. Day: one day. */
  weeks: CalendarDay[][]
  /** The same days, flat, in display order — what keyboard navigation walks. */
  days: CalendarDay[]
  /** Tasks with no due date at all. Never placed on the grid. */
  unscheduled: Task[]
  unscheduledTotal: number
  /** Context the rows need, loaded once for the whole period. */
  tags: Tag[]
  projects: Project[]
  progress: Map<Id, { done: number; total: number }>
  /** Totals across the visible period, after the filter. */
  counts: { total: number; completed: number; overdue: number }
}

const UNSCHEDULED_LIMIT = 25

/** All-day work first, then the timed work in clock order. */
function orderForDay(tasks: Task[]): { allDay: Task[]; timed: Task[] } {
  const allDay = tasks
    .filter((task) => task.dueTime === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)

  const timed = tasks
    .filter((task) => task.dueTime !== null)
    .sort(
      (a, b) =>
        timeToMinutes(a.dueTime as TimeStr) - timeToMinutes(b.dueTime as TimeStr) ||
        a.sortOrder - b.sortOrder,
    )

  return { allDay, timed }
}

export async function getCalendar(options: CalendarOptions): Promise<CalendarData> {
  const today = platform.clock.today()
  const settings = await settingsRepo.get()
  const weekStartsOn = settings.weekStartsOn
  const mode = options.mode
  const anchor = options.anchor ?? today

  const { from, to } = visibleRange(mode, anchor, weekStartsOn)

  const [dated, undated, tags, projects] = await Promise.all([
    taskRepo.dueInRange(from, to),
    taskRepo.undated(),
    tagRepo.list(),
    projectRepo.list(),
  ])

  const filter: TaskFilter = {
    ...DEFAULT_TASK_FILTER,
    status: options.status ?? 'all',
  }
  const index = buildSearchIndex(tags, projects)

  const visible = filterTasks(dated, filter, today, index)
  const visibleUndated = filterTasks(undated, filter, today, index)

  // One pass into buckets, rather than a scan of the task list per cell.
  const byDate = new Map<DateStr, Task[]>()
  for (const task of visible) {
    const date = task.dueDate
    if (date === null) continue
    const bucket = byDate.get(date)
    if (bucket) bucket.push(task)
    else byDate.set(date, [task])
  }

  const buildDay = (date: DateStr): CalendarDay => {
    const tasks = byDate.get(date) ?? []
    const { allDay, timed } = orderForDay(tasks)

    return {
      date,
      isToday: date === today,
      isCurrentMonth: mode !== 'month' || date.slice(0, 7) === anchor.slice(0, 7),
      isWeekend: isWeekend(date),
      tasks: [...allDay, ...timed],
      allDay,
      timed,
      overdueCount: tasks.filter((task) => isTaskOverdue(task, today)).length,
      completedCount: tasks.filter((task) => task.status === 'done').length,
    }
  }

  const weeks: CalendarDay[][] =
    mode === 'month'
      ? monthGrid(anchor, weekStartsOn).map((row) => row.map(buildDay))
      : mode === 'week'
        ? [weekDates(anchor, weekStartsOn).map(buildDay)]
        : [[buildDay(anchor)]]

  const days = weeks.flat()
  const limit = options.unscheduledLimit ?? UNSCHEDULED_LIMIT

  return {
    mode,
    anchor,
    today,
    weekStartsOn,
    title: periodTitle(mode, anchor, weekStartsOn),
    from,
    to,
    weeks,
    days,
    unscheduled: visibleUndated.slice(0, limit),
    unscheduledTotal: visibleUndated.length,
    tags,
    projects,
    progress: await loadProgress(days.flatMap((day) => day.tasks)),
    counts: {
      total: visible.length,
      completed: visible.filter((task) => task.status === 'done').length,
      overdue: visible.filter((task) => isTaskOverdue(task, today)).length,
    },
  }
}

/** Subtask progress for the tasks on screen, keyed by task id. */
async function loadProgress(tasks: Task[]): Promise<Map<Id, { done: number; total: number }>> {
  const progress = new Map<Id, { done: number; total: number }>()
  if (tasks.length === 0) return progress

  const rows = await subtaskRepo.list()
  const wanted = new Set(tasks.map((task) => task.id))
  for (const row of rows) {
    if (!wanted.has(row.taskId)) continue
    const current = progress.get(row.taskId) ?? { done: 0, total: 0 }
    current.total += 1
    if (row.done) current.done += 1
    progress.set(row.taskId, current)
  }
  return progress
}

/**
 * The tasks on one date, for a caller that wants a single day rather than a
 * period. Used by the cross-view consistency tests, and by anything that needs
 * to ask "what is on the 10th?" without building a grid.
 */
export async function getTasksOnDate(
  date: DateStr,
  status: TaskStatusFilter = 'all',
): Promise<Task[]> {
  const data = await getCalendar({ mode: 'day', anchor: date, status })
  return data.days[0]?.tasks ?? []
}
