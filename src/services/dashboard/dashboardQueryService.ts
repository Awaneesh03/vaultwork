import { platform } from '@/platform'
import { eventRepo, maintenanceRepo, projectRepo, subtaskRepo, tagRepo, taskRepo } from '@/repositories'
import type { AppEvent, DateStr, Id, Project, Tag, Task, Timestamp } from '@/types/entities'
import { projectPath } from '../commands/commandExecutor'
import { getGoalDashboard, type GoalDashboardSummary } from '../goalQueryService'
import { getTodayHabits, type TodayHabitSummary } from '../habitQueryService'
import { getRecentNotes, type RecentNote } from '../noteQueryService'
import { summarise, type ProjectSummary } from '../projects/projectStats'
import { sortTasks } from '../tasks/taskFilters'
import { groupToday, groupUpcoming, type TaskGroup } from '../tasks/taskViews'
import {
  completedOnDay,
  describeEvent,
  greetingFor,
  headlineFor,
  selectNextAction,
  type ActivityEntry,
  type DashboardSummary,
  type GreetingKey,
} from './dashboardStats'

/**
 * Everything the Dashboard reads, as one view model.
 *
 * Two rules shape this file.
 *
 * **It defines nothing.** "Today", "overdue", "upcoming" and a project's
 * progress are all M3/M4 concepts, and they arrive here through the same pure
 * functions the real screens use — `groupToday`, `groupUpcoming`, `sortTasks`,
 * `summarise`. The Dashboard is a *second reader* of those rules, never a
 * second definition of them; if Today's ordering changes, this changes with it.
 *
 * **It reads the table once.** Every task figure on the screen — four counts,
 * the next action, three previews — is derived from a single `listLive()` pass
 * plus the pure functions above, rather than from six indexed queries whose
 * results would then have to be reconciled. A dashboard that costs six reads to
 * answer one question is a dashboard that gets slower every milestone.
 */

/** How much of each section the Dashboard previews. */
export const DASHBOARD_LIMITS = {
  overdue: 5,
  today: 6,
  upcomingDays: 7,
  upcomingTasks: 6,
  projects: 5,
  activity: 8,
} as const

export interface DashboardData {
  today: DateStr
  /** The instant the view model was built, from the clock port. */
  now: Timestamp
  greeting: GreetingKey
  summary: DashboardSummary
  /** One sentence about the day, derived from `summary`. */
  headline: string

  /** The single task to work on next, or `null` when nothing is open. */
  nextAction: Task | null

  /** Overdue tasks, ordered as the Overdue view orders them. */
  overdue: Task[]
  overdueTotal: number

  /** Today's scheduled and anytime sections, in the Today view's order. */
  todayGroups: TaskGroup[]
  todayTotal: number

  /** The next few days that actually have work, earliest first. */
  upcomingGroups: TaskGroup[]
  upcomingTotal: number

  /** Active projects with their derived progress. Archived ones never appear. */
  projects: ProjectSummary[]
  projectsTotal: number

  activity: ActivityEntry[]

  /**
   * Today's habits, computed by `habitQueryService` rather than here.
   *
   * The Dashboard has no habit rules of its own: it renders the same summary
   * the Habits screen renders, so the two cannot report different counts.
   */
  habits: TodayHabitSummary

  /**
   * Active goals, computed by `goalQueryService` rather than here.
   *
   * Same rule as habits: the Dashboard has no goal arithmetic of its own, so a
   * goal's progress reads identically on both screens. Goals never feed the
   * Next Action — that stays task-only, because "become strong in DSA" is not
   * an answer to "what should I do in the next ten minutes".
   */
  goals: GoalDashboardSummary

  /**
   * The most recently *edited* notes, computed by `noteQueryService`.
   *
   * Recently edited rather than recently created: the note you were last
   * working in is the one you are most likely to want back.
   */
  notes: RecentNote[]

  /** Context the previewed rows need, loaded once. */
  tags: Tag[]
  allProjects: Project[]
  progress: Map<Id, { done: number; total: number }>

  /** Live row counts, for the footer strip. */
  counts: Record<string, number>
  eventCount: number
}

export async function getDashboard(): Promise<DashboardData> {
  const today = platform.clock.today()
  const now = platform.clock.now()

  const [tasks, projects, tags, events, counts, eventCount, habits, goals, notes] =
    await Promise.all([
      taskRepo.listLive(),
      projectRepo.listLive(),
      tagRepo.list(),
      eventRepo.latest(DASHBOARD_LIMITS.activity),
      maintenanceRepo.liveCounts(),
      eventRepo.count(),
      getTodayHabits(),
      getGoalDashboard(),
      getRecentNotes(),
    ])

  const open = tasks.filter((task) => task.status === 'todo')

  const summary: DashboardSummary = {
    open: open.length,
    // Strictly today. Overdue has its own tile, and a "due today" figure that
    // silently included late work would double-count the same rows.
    dueToday: open.filter((task) => task.dueDate === today).length,
    overdue: open.filter((task) => task.dueDate !== null && task.dueDate < today).length,
    completedToday: completedOnDay(tasks, today).length,
  }

  /*
   * `groupToday` returns [overdue, scheduled, anytime] — the Today view's own
   * three sections, from the Today view's own function. The Dashboard splits
   * them across two cards: the overdue rows get the dedicated Overdue card, and
   * the Today card shows what is actually scheduled for today. The union of the
   * two cards is exactly what /today renders, in the same order.
   */
  const todaySections = groupToday(open, today)
  const todayGroups = todaySections.filter((group) => group.id !== 'overdue')

  const overdueAll = sortTasks(
    open.filter((task) => task.dueDate !== null && task.dueDate < today),
    'dueDate',
    'asc',
  )

  const upcomingAll = groupUpcoming(open, today, DASHBOARD_LIMITS.upcomingDays).filter(
    (group) => group.tasks.length > 0,
  )

  const activeProjects = summarise(
    projects.filter((project) => project.status !== 'archived'),
    tasks,
    today,
  )

  const previewed = [
    ...limitGroups(todayGroups, DASHBOARD_LIMITS.today).flatMap((group) => group.tasks),
    ...overdueAll.slice(0, DASHBOARD_LIMITS.overdue),
  ]

  return {
    today,
    now,
    greeting: greetingFor(new Date(now).getHours()),
    summary,
    headline: headlineFor(summary),

    nextAction: selectNextAction(open, today),

    overdue: overdueAll.slice(0, DASHBOARD_LIMITS.overdue),
    overdueTotal: overdueAll.length,

    todayGroups: limitGroups(todayGroups, DASHBOARD_LIMITS.today),
    todayTotal: todaySections
      .filter((group) => group.id !== 'overdue')
      .reduce((sum, group) => sum + group.tasks.length, 0),

    upcomingGroups: limitGroups(upcomingAll, DASHBOARD_LIMITS.upcomingTasks),
    upcomingTotal: upcomingAll.reduce((sum, group) => sum + group.tasks.length, 0),

    projects: activeProjects.slice(0, DASHBOARD_LIMITS.projects),
    projectsTotal: activeProjects.length,

    activity: toActivity(events, tasks, projects),
    habits,
    goals,
    notes,

    tags,
    allProjects: projects,
    progress: await loadProgress(previewed),

    counts,
    eventCount,
  }
}

/**
 * Trims a list of groups to a total task budget, dropping whole groups once the
 * budget runs out. Cutting mid-group would show "Tomorrow" with two of its five
 * tasks and no indication that three are missing.
 */
function limitGroups(groups: TaskGroup[], budget: number): TaskGroup[] {
  const kept: TaskGroup[] = []
  let remaining = budget

  for (const group of groups) {
    if (remaining <= 0) break
    const tasks = group.tasks.slice(0, remaining)
    if (tasks.length === 0) continue
    kept.push({ ...group, tasks })
    remaining -= tasks.length
  }
  return kept
}

/**
 * Turns raw events into readable lines.
 *
 * Names are resolved from rows already in memory where possible, and the event
 * payload wins when it has one — a completed task records its own title, so the
 * log still reads correctly after the task is renamed or deleted.
 */
function toActivity(events: AppEvent[], tasks: Task[], projects: Project[]): ActivityEntry[] {
  const taskNames = new Map(tasks.map((task) => [task.id, task.title]))
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))

  return events.map((event) => {
    const id = event.entityId
    const resolved =
      id === null
        ? null
        : (event.entityType === 'project' ? projectNames.get(id) : taskNames.get(id)) ?? null

    return {
      id: event.id,
      at: event.at,
      type: event.type,
      label: describeEvent(event, resolved),
      entityType: event.entityType,
      entityId: id,
      source: event.source,
      // Only link where the row still exists; a link to a deleted task is a
      // dead end, and the line is still worth reading without one.
      // `projectPath` is the command layer's own definition of where a project
      // lives, so the log and `/project <name>` cannot disagree.
      href:
        id !== null && event.entityType === 'project' && projectNames.has(id)
          ? projectPath(id)
          : null,
    }
  })
}

/** Subtask progress for the rows on screen, keyed by task id. */
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
