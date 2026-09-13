import { addDays, toDateStr } from '@/lib/date'
import type { DateStr, Id, Task } from '@/types/entities'
import type { Priority, TaskStatus } from '@/types/enums'

/**
 * Filtering, sorting and search — all pure.
 *
 * Nothing here touches a repository, so every rule is testable against a plain
 * array. The query service reads rows and then runs them through these; that
 * split is what keeps "which tasks does Today show?" answerable without a
 * database.
 */

export type TaskStatusFilter = TaskStatus | 'all'

export type DueFilter =
  | 'any'
  | 'today'
  | 'tomorrow'
  | 'week'
  | 'overdue'
  | 'scheduled'
  | 'unscheduled'

export type EstimateFilter = 'any' | 'yes' | 'no'

export interface TaskFilter {
  status: TaskStatusFilter
  /** Empty means every priority. */
  priorities: Priority[]
  /** `'any'` applies no constraint; `null` matches tasks with no project. */
  projectId: Id | null | 'any'
  /** Empty means every tag. */
  tagIds: Id[]
  tagMode: 'any' | 'all'
  due: DueFilter
  hasEstimate: EstimateFilter
  search: string
  /** Inclusive day range. Used by the view queries rather than the toolbar. */
  dueFrom?: DateStr | undefined
  dueTo?: DateStr | undefined
  /** Only tasks completed within this many days. Used by the Completed view. */
  completedWithin?: number | undefined
}

export const DEFAULT_TASK_FILTER: TaskFilter = {
  status: 'todo',
  priorities: [],
  projectId: 'any',
  tagIds: [],
  tagMode: 'any',
  due: 'any',
  hasEstimate: 'any',
  search: '',
}

export type TaskSort = 'manual' | 'dueDate' | 'priority' | 'created' | 'updated' | 'completed'
export type SortDirection = 'asc' | 'desc'

export const TASK_SORTS: { id: TaskSort; label: string; defaultDirection: SortDirection }[] = [
  { id: 'manual', label: 'Manual order', defaultDirection: 'asc' },
  { id: 'dueDate', label: 'Due date', defaultDirection: 'asc' },
  { id: 'priority', label: 'Priority', defaultDirection: 'desc' },
  { id: 'created', label: 'Created', defaultDirection: 'desc' },
  { id: 'updated', label: 'Updated', defaultDirection: 'desc' },
  { id: 'completed', label: 'Completed', defaultDirection: 'desc' },
]

/** Higher sorts first when sorting by priority descending. */
export const PRIORITY_RANK: Record<Priority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
}

export function isFilterActive(filter: TaskFilter): boolean {
  return (
    filter.priorities.length > 0 ||
    filter.projectId !== 'any' ||
    filter.tagIds.length > 0 ||
    filter.due !== 'any' ||
    filter.hasEstimate !== 'any' ||
    filter.search.trim().length > 0
  )
}

// -------------------------------------------------------------------- search

export interface TaskSearchIndex {
  tagNames: Map<Id, string>
  projectNames: Map<Id, string>
}

export const EMPTY_SEARCH_INDEX: TaskSearchIndex = {
  tagNames: new Map(),
  projectNames: new Map(),
}

export function buildSearchIndex(
  tags: { id: Id; name: string }[],
  projects: { id: Id; name: string }[],
): TaskSearchIndex {
  return {
    tagNames: new Map(tags.map((t) => [t.id, t.name.toLowerCase()])),
    projectNames: new Map(projects.map((p) => [p.id, p.name.toLowerCase()])),
  }
}

/** Title, description, tag names and project name — the four fields worth searching. */
function haystack(task: Task, index: TaskSearchIndex): string {
  const parts = [task.title, task.description ?? '']
  for (const tagId of task.tagIds) parts.push(index.tagNames.get(tagId) ?? '')
  if (task.projectId) parts.push(index.projectNames.get(task.projectId) ?? '')
  return parts.join('   ').toLowerCase()
}

/**
 * Every whitespace-separated term must appear somewhere. "java tree" finds a
 * task tagged `java` titled "Binary Trees", which a single substring match
 * would miss.
 */
export function matchesSearch(
  task: Task,
  query: string,
  index: TaskSearchIndex = EMPTY_SEARCH_INDEX,
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const text = haystack(task, index)
  return terms.every((term) => text.includes(term))
}

// ------------------------------------------------------------------ filtering

/**
 * Overdue, defined once.
 *
 * Still open, and its due date has already passed in *local* calendar terms.
 * The Overdue view, the Today grouping, the Dashboard and the Calendar all call
 * this rather than re-writing the comparison, so none of them can quietly grow
 * a different idea of "late".
 */
export function isTaskOverdue(task: Task, today: DateStr): boolean {
  return task.status === 'todo' && task.dueDate !== null && task.dueDate < today
}

function matchesDue(task: Task, due: DueFilter, today: DateStr): boolean {
  switch (due) {
    case 'any':
      return true
    case 'today':
      return task.dueDate === today
    case 'tomorrow':
      return task.dueDate === addDays(today, 1)
    case 'week':
      return task.dueDate !== null && task.dueDate <= addDays(today, 7)
    case 'overdue':
      return isTaskOverdue(task, today)
    case 'scheduled':
      return task.dueDate !== null
    case 'unscheduled':
      return task.dueDate === null
  }
}

export function filterTasks(
  tasks: Task[],
  filter: TaskFilter,
  today: DateStr,
  index: TaskSearchIndex = EMPTY_SEARCH_INDEX,
): Task[] {
  const search = filter.search.trim()

  return tasks.filter((task) => {
    if (filter.status !== 'all' && task.status !== filter.status) return false

    if (filter.priorities.length > 0 && !filter.priorities.includes(task.priority)) return false

    if (filter.projectId !== 'any' && task.projectId !== filter.projectId) return false

    if (filter.tagIds.length > 0) {
      const matched =
        filter.tagMode === 'all'
          ? filter.tagIds.every((id) => task.tagIds.includes(id))
          : filter.tagIds.some((id) => task.tagIds.includes(id))
      if (!matched) return false
    }

    if (!matchesDue(task, filter.due, today)) return false

    if (filter.hasEstimate === 'yes' && task.estimateMin === null) return false
    if (filter.hasEstimate === 'no' && task.estimateMin !== null) return false

    if (filter.dueFrom !== undefined && (task.dueDate === null || task.dueDate < filter.dueFrom)) {
      return false
    }
    if (filter.dueTo !== undefined && (task.dueDate === null || task.dueDate > filter.dueTo)) {
      return false
    }

    if (filter.completedWithin !== undefined) {
      if (task.completedAt === null) return false
      // Compared on calendar days: "the last 7 days" is seven days, not 168 hours.
      const completedOn = toDateStr(new Date(task.completedAt))
      if (completedOn < addDays(today, -filter.completedWithin)) return false
    }

    if (search.length > 0 && !matchesSearch(task, search, index)) return false

    return true
  })
}

// -------------------------------------------------------------------- sorting

/** Within a day, a timed task comes before an untimed one. */
function compareTime(a: Task, b: Task): number {
  if (a.dueTime === b.dueTime) return a.sortOrder - b.sortOrder
  if (a.dueTime === null) return 1
  if (b.dueTime === null) return -1
  return a.dueTime < b.dueTime ? -1 : 1
}

/** Null due dates sort last in both directions: undated is not "the year 0". */
function compareDueDate(a: Task, b: Task): number {
  if (a.dueDate === b.dueDate) return compareTime(a, b)
  if (a.dueDate === null) return 1
  if (b.dueDate === null) return -1
  return a.dueDate < b.dueDate ? -1 : 1
}

function comparator(sort: TaskSort): (a: Task, b: Task) => number {
  switch (sort) {
    case 'manual':
      return (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt
    case 'dueDate':
      return compareDueDate
    case 'priority':
      return (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || compareDueDate(a, b)
    case 'created':
      return (a, b) => a.createdAt - b.createdAt
    case 'updated':
      return (a, b) => a.updatedAt - b.updatedAt
    case 'completed':
      return (a, b) => (a.completedAt ?? a.updatedAt) - (b.completedAt ?? b.updatedAt)
  }
}

/**
 * Sorts a copy. A live query hands the same array to several consumers, so
 * sorting in place is a bug that only shows up under a second subscriber.
 */
export function sortTasks(tasks: Task[], sort: TaskSort, direction: SortDirection = 'asc'): Task[] {
  const sorted = [...tasks].sort(comparator(sort))
  return direction === 'desc' ? sorted.reverse() : sorted
}

export function defaultDirectionFor(sort: TaskSort): SortDirection {
  return TASK_SORTS.find((entry) => entry.id === sort)?.defaultDirection ?? 'asc'
}
