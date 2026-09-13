import { addDays } from '@/lib/date'
import { platform } from '@/platform'
import { projectRepo, subtaskRepo, tagRepo, taskRepo } from '@/repositories'
import type { DateStr, Id, Project, Subtask, Tag, Task } from '@/types/entities'
import {
  buildSearchIndex,
  DEFAULT_TASK_FILTER,
  defaultDirectionFor,
  filterTasks,
  sortTasks,
  type SortDirection,
  type TaskFilter,
  type TaskSearchIndex,
  type TaskSort,
} from './tasks/taskFilters'
import {
  DEFAULT_UPCOMING_DAYS,
  clampUpcomingDays,
  groupCompleted,
  groupToday,
  groupUpcoming,
  singleGroup,
  totalEstimate,
  type TaskGroup,
  type TaskViewId,
} from './tasks/taskViews'

/**
 * Every read the task UI performs.
 *
 * Each view starts from the narrowest *indexed* query the repository offers —
 * `[status+dueDate]` for Today, Overdue and Upcoming; `status` for Completed —
 * and only then applies the user's filters, which are pure functions over the
 * result. The database does the work it is good at, and the rules that are
 * actually a design decision stay testable against a plain array.
 */

export interface TaskViewOptions {
  filter?: Partial<TaskFilter> | undefined
  sort?: TaskSort | undefined
  direction?: SortDirection | undefined
  /** Rolling window for Upcoming, clamped to 7–14 days. */
  upcomingDays?: number | undefined
}

export interface TaskViewData {
  view: TaskViewId
  today: DateStr
  /** Sections in display order. Upcoming keeps its empty days. */
  groups: TaskGroup[]
  /** The same tasks, flat, in display order — what keyboard selection walks. */
  tasks: Task[]
  tags: Tag[]
  projects: Project[]
  /** Subtask progress for every task on screen, keyed by task id. */
  progress: Map<Id, { done: number; total: number }>
  totalEstimateMin: number
  /** Rows the view's own query returned, before the user's filters. */
  unfilteredCount: number
}

/** What each view constrains regardless of the toolbar. */
const VIEW_BASE: Record<TaskViewId, Partial<TaskFilter>> = {
  inbox: { status: 'todo', projectId: null },
  today: { status: 'todo' },
  upcoming: { status: 'todo' },
  overdue: { status: 'todo' },
  completed: { status: 'done' },
  all: { status: 'all' },
}

/** The sort each view opens with. */
export const VIEW_DEFAULT_SORT: Record<TaskViewId, TaskSort> = {
  inbox: 'manual',
  today: 'manual',
  upcoming: 'dueDate',
  overdue: 'dueDate',
  completed: 'completed',
  all: 'manual',
}

async function readForView(view: TaskViewId, today: DateStr, days: number): Promise<Task[]> {
  switch (view) {
    case 'inbox':
      return taskRepo.inbox()
    case 'today': {
      const [overdue, due] = await Promise.all([taskRepo.overdue(today), taskRepo.dueOn(today)])
      return [...overdue, ...due]
    }
    case 'upcoming':
      return taskRepo.dueBetween(addDays(today, 1), addDays(today, clampUpcomingDays(days)))
    case 'overdue':
      return taskRepo.overdue(today)
    case 'completed':
      return taskRepo.completed()
    case 'all':
      return taskRepo.listLive()
  }
}

function groupsFor(
  view: TaskViewId,
  tasks: Task[],
  today: DateStr,
  days: number,
  sort: TaskSort,
): TaskGroup[] {
  switch (view) {
    case 'today':
      // The hand-ordered sections are the point of Today, so a chosen sort
      // flattens the view rather than fighting the grouping.
      return sort === 'manual' ? groupToday(tasks, today) : singleGroup('today', tasks, false)
    case 'upcoming':
      return groupUpcoming(tasks, today, days)
    case 'completed':
      return groupCompleted(tasks, today)
    case 'inbox':
      return singleGroup('inbox', tasks, sort === 'manual')
    case 'overdue':
      return singleGroup('overdue', tasks, false)
    case 'all':
      return singleGroup('all', tasks, sort === 'manual')
  }
}

async function loadContext(): Promise<{
  tags: Tag[]
  projects: Project[]
  index: TaskSearchIndex
}> {
  const [tags, projects] = await Promise.all([tagRepo.list(), projectRepo.list()])
  return { tags, projects, index: buildSearchIndex(tags, projects) }
}

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

export async function getTaskView(
  view: TaskViewId,
  options: TaskViewOptions = {},
): Promise<TaskViewData> {
  const today = platform.clock.today()
  const days = options.upcomingDays ?? DEFAULT_UPCOMING_DAYS

  const [rows, context] = await Promise.all([readForView(view, today, days), loadContext()])

  const filter: TaskFilter = {
    ...DEFAULT_TASK_FILTER,
    ...VIEW_BASE[view],
    ...(options.filter ?? {}),
  }

  const sort = options.sort ?? VIEW_DEFAULT_SORT[view]
  const direction = options.direction ?? defaultDirectionFor(sort)

  const filtered = filterTasks(rows, filter, today, context.index)
  const ordered = sort === 'manual' ? filtered : sortTasks(filtered, sort, direction)
  const groups = groupsFor(view, ordered, today, days, sort)
  const flat = groups.flatMap((section) => section.tasks)

  return {
    view,
    today,
    groups,
    tasks: flat,
    tags: context.tags,
    projects: context.projects,
    progress: await loadProgress(flat),
    totalEstimateMin: totalEstimate(flat.filter((task) => task.status === 'todo')),
    unfilteredCount: rows.length,
  }
}

export interface TaskCounts {
  inbox: number
  today: number
  upcoming: number
  overdue: number
  completed: number
  all: number
}

/** Badge counts for the sidebar. One pass over the live rows, not six queries. */
export async function getTaskCounts(): Promise<TaskCounts> {
  const today = platform.clock.today()
  const horizon = addDays(today, DEFAULT_UPCOMING_DAYS)
  const tasks = await taskRepo.listLive()

  const open = tasks.filter((task) => task.status === 'todo')

  return {
    inbox: open.filter((task) => task.projectId === null).length,
    today: open.filter((task) => task.dueDate !== null && task.dueDate <= today).length,
    upcoming: open.filter(
      (task) => task.dueDate !== null && task.dueDate > today && task.dueDate <= horizon,
    ).length,
    overdue: open.filter((task) => task.dueDate !== null && task.dueDate < today).length,
    completed: tasks.filter((task) => task.status === 'done').length,
    all: tasks.length,
  }
}

/** Free-text search across title, description, tags and project. */
export async function searchTasks(query: string, limit = 25): Promise<Task[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const today = platform.clock.today()
  const [tasks, context] = await Promise.all([taskRepo.listLive(), loadContext()])

  const matched = filterTasks(
    tasks,
    { ...DEFAULT_TASK_FILTER, status: 'all', search: trimmed },
    today,
    context.index,
  )

  // Open tasks first: you are far more often looking for something to do than
  // for something you already did.
  return matched
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'todo' ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
    .slice(0, limit)
}

export interface TaskDetailData {
  task: Task
  subtasks: Subtask[]
  tags: Tag[]
  project: Project | null
  allTags: Tag[]
  allProjects: Project[]
}

export async function getTaskDetail(id: Id): Promise<TaskDetailData | undefined> {
  const task = await taskRepo.get(id)
  if (!task) return undefined

  const [subtasks, context] = await Promise.all([subtaskRepo.byTask(id), loadContext()])

  return {
    task,
    subtasks,
    // Only live tags: a deleted tag's id stays on the row so that restoring it
    // brings the assignment back, but it must not render as a phantom chip.
    tags: context.tags.filter((tag) => task.tagIds.includes(tag.id)),
    project: context.projects.find((project) => project.id === task.projectId) ?? null,
    allTags: context.tags,
    allProjects: context.projects,
  }
}

/** Tags and projects on their own, for the composer's pickers. */
export async function getTaskMetadata(): Promise<{ tags: Tag[]; projects: Project[] }> {
  const { tags, projects } = await loadContext()
  return { tags, projects }
}
