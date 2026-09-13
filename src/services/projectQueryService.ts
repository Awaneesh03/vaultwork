import { platform } from '@/platform'
import { projectRepo, subtaskRepo, tagRepo, taskRepo } from '@/repositories'
import type { DateStr, Id, Project, Subtask, Tag, Task } from '@/types/entities'
import {
  DEFAULT_PROJECT_FILTER,
  computeProjectStats,
  filterProjects,
  isArchived,
  progressPercent,
  sortProjects,
  summarise,
  type ProjectFilter,
  type ProjectSort,
  type ProjectStats,
  type ProjectSummary,
} from './projects/projectStats'
import {
  DEFAULT_TASK_FILTER,
  buildSearchIndex,
  defaultDirectionFor,
  filterTasks,
  sortTasks,
  type SortDirection,
  type TaskFilter,
  type TaskSort,
} from './tasks/taskFilters'
import { groupProjectTasks, totalEstimate, type TaskGroup } from './tasks/taskViews'

/**
 * Every read the Projects UI performs.
 *
 * The shape mirrors `taskQueryService` deliberately: read the narrowest query
 * the repository offers, then apply the user's filters as pure functions. What
 * a project *is* comes from Dexie; what a project is *worth* is computed from
 * its tasks at read time, every time — see `projects/projectStats.ts` for why
 * progress is never stored.
 */

export interface ProjectsViewOptions {
  filter?: Partial<ProjectFilter> | undefined
  sort?: ProjectSort | undefined
}

export interface ProjectsViewData {
  today: DateStr
  /** Non-archived projects that survived the filter, in the chosen order. */
  active: ProjectSummary[]
  /** Archived projects that survived the filter. */
  archived: ProjectSummary[]
  /** Totals before the filter ran, so an empty result can explain itself. */
  activeTotal: number
  archivedTotal: number
  /** Open tasks with no project at all — the Inbox, by its M3 definition. */
  inboxCount: number
  /** Every live project, for pickers that need the full list. */
  projects: Project[]
  /** Rolled-up numbers across the projects on screen. */
  totals: ProjectStats
}

/**
 * The Projects screen.
 *
 * Active and archived are returned as two lists rather than one filtered list,
 * because the screen shows both and the filter's `state` decides which of them
 * is allowed to be non-empty. Keeping the split here means the component does
 * no partitioning of its own.
 */
export async function getProjectsView(
  options: ProjectsViewOptions = {},
): Promise<ProjectsViewData> {
  const today = platform.clock.today()
  const filter: ProjectFilter = { ...DEFAULT_PROJECT_FILTER, ...(options.filter ?? {}) }
  const sort = options.sort ?? 'manual'

  const [projects, tasks] = await Promise.all([projectRepo.listLive(), taskRepo.listLive()])

  const summaries = summarise(projects, tasks, today)
  const activeAll = summaries.filter((entry) => !isArchived(entry.project))
  const archivedAll = summaries.filter((entry) => isArchived(entry.project))

  // The archived section is only ever populated when the state filter admits
  // it, so "Active" genuinely hides the archive rather than merely collapsing
  // it — which is the whole reason the filter exists.
  const wantsActive = filter.state !== 'archived'
  const wantsArchived = filter.state !== 'active'

  const active = wantsActive
    ? sortProjects(filterProjects(activeAll, { ...filter, state: 'all' }), sort)
    : []
  const archived = wantsArchived
    ? sortProjects(filterProjects(archivedAll, { ...filter, state: 'all' }), sort)
    : []

  const onScreen = [...active, ...archived]

  return {
    today,
    active,
    archived,
    activeTotal: activeAll.length,
    archivedTotal: archivedAll.length,
    inboxCount: tasks.filter((task) => task.status === 'todo' && task.projectId === null).length,
    projects,
    totals: rollUp(onScreen),
  }
}

/** One combined figure for the header. Not a per-project stat, a sum of them. */
function rollUp(summaries: ProjectSummary[]): ProjectStats {
  const stats = summaries.map((entry) => entry.stats)
  const total = stats.reduce((sum, entry) => sum + entry.total, 0)
  const completed = stats.reduce((sum, entry) => sum + entry.completed, 0)

  const nextDueDate = stats.reduce<DateStr | null>((earliest, entry) => {
    const due = entry.nextDueDate
    if (due === null) return earliest
    return earliest === null || due < earliest ? due : earliest
  }, null)

  return {
    total,
    completed,
    remaining: total - completed,
    overdue: stats.reduce((sum, entry) => sum + entry.overdue, 0),
    dueToday: stats.reduce((sum, entry) => sum + entry.dueToday, 0),
    scheduled: stats.reduce((sum, entry) => sum + entry.scheduled, 0),
    // Progress across projects is progress across *tasks*, not the mean of the
    // per-project percentages: two projects of 1 and 99 tasks are not half done
    // because one of them is finished.
    progress: progressPercent(completed, total),
    nextDueDate,
    remainingEstimateMin: stats.reduce((sum, entry) => sum + entry.remainingEstimateMin, 0),
  }
}

// ------------------------------------------------------------------- detail

export interface ProjectDetailOptions {
  filter?: Partial<TaskFilter> | undefined
  sort?: TaskSort | undefined
  direction?: SortDirection | undefined
}

export interface ProjectDetailData {
  project: Project
  stats: ProjectStats
  today: DateStr
  /** Open first, then completed. Empty sections are dropped. */
  groups: TaskGroup[]
  /** The same tasks, flat, in display order — what keyboard selection walks. */
  tasks: Task[]
  tags: Tag[]
  /** Every live project, so the detail screen can move a task elsewhere. */
  projects: Project[]
  /** Subtask progress for every task on screen, keyed by task id. */
  progress: Map<Id, { done: number; total: number }>
  totalEstimateMin: number
  /** Tasks the project's own query returned, before the user's filters. */
  unfilteredCount: number
  /** Open tasks that belong to some other project, or none — assignable here. */
  assignable: Task[]
}

/**
 * One project and its work.
 *
 * The task half is assembled from exactly the M3 pieces — `taskRepo.byProject`,
 * `filterTasks`, `sortTasks`, the same subtask progress map — so a project's
 * task list is the task list, not a second implementation of it. The only thing
 * this adds is the grouping, which lives in `taskViews` with the other five.
 */
export async function getProjectDetail(
  id: Id,
  options: ProjectDetailOptions = {},
): Promise<ProjectDetailData | undefined> {
  const project = await projectRepo.get(id)
  if (!project) return undefined

  const today = platform.clock.today()

  const [rows, allTasks, tags, projects] = await Promise.all([
    taskRepo.byProject(id),
    taskRepo.listLive(),
    tagRepo.list(),
    projectRepo.listLive(),
  ])

  const filter: TaskFilter = {
    ...DEFAULT_TASK_FILTER,
    status: 'all',
    ...(options.filter ?? {}),
    // The project is the view: a project filter on top of it would be two
    // answers to the same question, and the wrong one would win.
    projectId: id,
  }

  const sort = options.sort ?? 'manual'
  const direction = options.direction ?? defaultDirectionFor(sort)
  const index = buildSearchIndex(tags, projects)

  const filtered = filterTasks(rows, filter, today, index)
  const ordered = sort === 'manual' ? filtered : sortTasks(filtered, sort, direction)
  const groups = groupProjectTasks(ordered, sort === 'manual')
  const flat = groups.flatMap((group) => group.tasks)

  return {
    project,
    // Stats describe the project, not the filtered view: filtering the list
    // must not make the progress bar move.
    stats: computeProjectStats(rows, today),
    today,
    groups,
    tasks: flat,
    tags,
    projects,
    progress: await loadProgress(flat),
    totalEstimateMin: totalEstimate(flat.filter((task) => task.status === 'todo')),
    unfilteredCount: rows.length,
    assignable: allTasks.filter((task) => task.status === 'todo' && task.projectId !== id),
  }
}

async function loadProgress(tasks: Task[]): Promise<Map<Id, { done: number; total: number }>> {
  const progress = new Map<Id, { done: number; total: number }>()
  if (tasks.length === 0) return progress

  const rows: Subtask[] = await subtaskRepo.list()
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

// -------------------------------------------------------------------- counts

export interface ProjectCounts {
  active: number
  archived: number
  /** Active projects with at least one overdue task. */
  withOverdue: number
}

/** Badge counts for the sidebar and the Projects header. One pass over rows. */
export async function getProjectCounts(): Promise<ProjectCounts> {
  const today = platform.clock.today()
  const [projects, tasks] = await Promise.all([projectRepo.listLive(), taskRepo.listLive()])
  const summaries = summarise(projects, tasks, today)

  return {
    active: summaries.filter((entry) => !isArchived(entry.project)).length,
    archived: summaries.filter((entry) => isArchived(entry.project)).length,
    withOverdue: summaries.filter((entry) => !isArchived(entry.project) && entry.stats.overdue > 0)
      .length,
  }
}

/** Free-text project search, for the command palette and the toolbar. */
export async function searchProjects(query: string, limit = 25): Promise<ProjectSummary[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const view = await getProjectsView({
    filter: { state: 'all', search: trimmed },
    sort: 'name',
  })

  return [...view.active, ...view.archived].slice(0, limit)
}
