import type { DateStr, Id, Project, Task } from '@/types/entities'
import type { ProjectStatus } from '@/types/enums'

/**
 * What a project *is worth looking at for*, as pure functions over tasks.
 *
 * Nothing here touches a repository, so every rule — what counts as overdue,
 * what 0 % of nothing means, how a search matches — is testable against a plain
 * array. The query service reads rows and runs them through these.
 *
 * The governing rule: **progress is derived, never stored.** A project row has
 * no `completedCount` and no `progress` column, so the number on screen cannot
 * drift from the tasks it claims to describe, and it cannot be faked by writing
 * to it.
 */

export interface ProjectStats {
  /** Live, non-template tasks pointing at this project. */
  total: number
  completed: number
  remaining: number
  /** Open tasks whose due date is strictly before today. */
  overdue: number
  /** Open tasks due today. */
  dueToday: number
  /** Open tasks with a due date at all. */
  scheduled: number
  /** Whole percent, 0–100. A project with no tasks is 0, not NaN. */
  progress: number
  /** Earliest due date among open tasks, for the "next up" hint. */
  nextDueDate: DateStr | null
  /** Estimated minutes still outstanding. */
  remainingEstimateMin: number
}

export const EMPTY_PROJECT_STATS: ProjectStats = {
  total: 0,
  completed: 0,
  remaining: 0,
  overdue: 0,
  dueToday: 0,
  scheduled: 0,
  progress: 0,
  nextDueDate: null,
  remainingEstimateMin: 0,
}

/**
 * Rounds toward the truth at both ends: a project with any work left never
 * reads 100 %, and a project with anything done never reads 0 %. Plain
 * `Math.round` would show "100%" beside an open task, which is a lie a progress
 * bar cannot afford to tell.
 */
export function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0
  if (completed <= 0) return 0
  if (completed >= total) return 100
  return Math.min(99, Math.max(1, Math.round((completed / total) * 100)))
}

export function computeProjectStats(tasks: Task[], today: DateStr): ProjectStats {
  if (tasks.length === 0) return EMPTY_PROJECT_STATS

  const open = tasks.filter((task) => task.status === 'todo')
  const completed = tasks.length - open.length
  const dated = open.filter((task) => task.dueDate !== null)

  const nextDueDate = dated.reduce<DateStr | null>((earliest, task) => {
    const due = task.dueDate
    if (due === null) return earliest
    return earliest === null || due < earliest ? due : earliest
  }, null)

  return {
    total: tasks.length,
    completed,
    remaining: open.length,
    overdue: dated.filter((task) => (task.dueDate as DateStr) < today).length,
    dueToday: dated.filter((task) => task.dueDate === today).length,
    scheduled: dated.length,
    progress: progressPercent(completed, tasks.length),
    nextDueDate,
    remainingEstimateMin: open.reduce((sum, task) => sum + (task.estimateMin ?? 0), 0),
  }
}

/** Stats for every project in one pass over the task list. */
export function statsByProject(tasks: Task[], today: DateStr): Map<Id, ProjectStats> {
  const grouped = new Map<Id, Task[]>()
  for (const task of tasks) {
    const projectId = task.projectId
    if (projectId === null) continue
    const bucket = grouped.get(projectId)
    if (bucket) bucket.push(task)
    else grouped.set(projectId, [task])
  }

  const stats = new Map<Id, ProjectStats>()
  for (const [projectId, rows] of grouped) {
    stats.set(projectId, computeProjectStats(rows, today))
  }
  return stats
}

/** A project plus the numbers derived from its tasks. What a row renders. */
export interface ProjectSummary {
  project: Project
  stats: ProjectStats
}

export function summarise(projects: Project[], tasks: Task[], today: DateStr): ProjectSummary[] {
  const stats = statsByProject(tasks, today)
  return projects.map((project) => ({
    project,
    stats: stats.get(project.id) ?? EMPTY_PROJECT_STATS,
  }))
}

export const isArchived = (project: Project): boolean => project.status === 'archived'

// ----------------------------------------------------------------- filtering

/** Which half of the list you are looking at. */
export type ProjectStateFilter = 'active' | 'archived' | 'all'

/**
 * A filter over derived numbers rather than stored fields — which is why it
 * lives beside the stats it reads.
 */
export type ProjectProgressFilter = 'any' | 'overdue' | 'in_progress' | 'complete' | 'empty'

export interface ProjectFilter {
  state: ProjectStateFilter
  progress: ProjectProgressFilter
  /** `'any'` applies no constraint. */
  status: ProjectStatus | 'any'
  search: string
}

export const DEFAULT_PROJECT_FILTER: ProjectFilter = {
  state: 'active',
  progress: 'any',
  status: 'any',
  search: '',
}

export function isProjectFilterActive(filter: ProjectFilter): boolean {
  return filter.progress !== 'any' || filter.status !== 'any' || filter.search.trim().length > 0
}

/**
 * Name and description, every term required.
 *
 * Same rule as task search: "port site" finds "Portfolio Site", which a single
 * substring match would miss.
 */
export function matchesProjectSearch(project: Project, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const text = `${project.name}   ${project.description ?? ''}`.toLowerCase()
  return terms.every((term) => text.includes(term))
}

function matchesProgress(stats: ProjectStats, progress: ProjectProgressFilter): boolean {
  switch (progress) {
    case 'any':
      return true
    case 'overdue':
      return stats.overdue > 0
    case 'in_progress':
      return stats.total > 0 && stats.remaining > 0
    case 'complete':
      return stats.total > 0 && stats.remaining === 0
    case 'empty':
      return stats.total === 0
  }
}

function matchesState(project: Project, state: ProjectStateFilter): boolean {
  switch (state) {
    case 'all':
      return true
    case 'archived':
      return isArchived(project)
    case 'active':
      return !isArchived(project)
  }
}

export function filterProjects(
  summaries: ProjectSummary[],
  filter: ProjectFilter,
): ProjectSummary[] {
  const search = filter.search.trim()

  return summaries.filter(({ project, stats }) => {
    if (!matchesState(project, filter.state)) return false
    if (filter.status !== 'any' && project.status !== filter.status) return false
    if (!matchesProgress(stats, filter.progress)) return false
    if (search.length > 0 && !matchesProjectSearch(project, search)) return false
    return true
  })
}

// ------------------------------------------------------------------- sorting

export type ProjectSort = 'manual' | 'name' | 'progress' | 'remaining' | 'overdue' | 'updated'

export const PROJECT_SORTS: { id: ProjectSort; label: string }[] = [
  { id: 'manual', label: 'Manual order' },
  { id: 'name', label: 'Name' },
  { id: 'progress', label: 'Progress' },
  { id: 'remaining', label: 'Remaining' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'updated', label: 'Updated' },
]

const byManual = (a: ProjectSummary, b: ProjectSummary) =>
  a.project.sortOrder - b.project.sortOrder || a.project.createdAt - b.project.createdAt

/** Sorts a copy — a live query hands the same array to several consumers. */
export function sortProjects(summaries: ProjectSummary[], sort: ProjectSort): ProjectSummary[] {
  const rows = [...summaries]

  switch (sort) {
    case 'manual':
      return rows.sort(byManual)
    case 'name':
      return rows.sort((a, b) => a.project.name.localeCompare(b.project.name) || byManual(a, b))
    case 'progress':
      return rows.sort((a, b) => b.stats.progress - a.stats.progress || byManual(a, b))
    case 'remaining':
      return rows.sort((a, b) => b.stats.remaining - a.stats.remaining || byManual(a, b))
    case 'overdue':
      return rows.sort((a, b) => b.stats.overdue - a.stats.overdue || byManual(a, b))
    case 'updated':
      return rows.sort((a, b) => b.project.updatedAt - a.project.updatedAt || byManual(a, b))
  }
}
