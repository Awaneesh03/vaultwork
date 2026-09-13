import { platform } from '@/platform'
import { goalRepo, milestoneRepo, projectRepo, taskRepo } from '@/repositories'
import type { DateStr, Goal, Id, Milestone, Project, Task } from '@/types/entities'
import {
  DEFAULT_GOAL_FILTER,
  calculateGoalProgress,
  calculateGoalTaskProgress,
  calculateMilestoneProgress,
  filterGoals,
  getGoalHealth,
  isGoalActive,
  isGoalArchived,
  isGoalCompleted,
  isMilestoneOverdue,
  milestonesOf,
  progressOf,
  sortGoals,
  type GoalFilter,
  type GoalHealth,
  type GoalSort,
  type GoalSummary,
  type Progress,
} from './goals/goalStats'

/**
 * Every read the goal UI performs — and the one the Dashboard performs.
 *
 * Both screens go through the functions here, and the numbers themselves come
 * from the pure module, so the Goals page and the Dashboard card cannot report
 * different progress for the same goal. There is no dashboard-specific goal
 * arithmetic anywhere.
 *
 * The whole screen is assembled from four table reads regardless of how many
 * goals exist — goals, milestones, projects, tasks — and joined in memory.
 * Querying per goal would be an N+1 that gets slower with every goal added.
 */

export interface MilestoneView {
  milestone: Milestone
  /** Task counts under this checkpoint. Reported beside `done`, never instead. */
  tasks: Progress
  overdue: boolean
}

export interface GoalListItem extends GoalSummary {
  milestoneViews: MilestoneView[]
  /** Projects pointing at this goal — the second route from goal to work. */
  projects: Project[]
}

export interface GoalsViewData {
  today: DateStr
  goals: GoalListItem[]
  /** Counts across every live goal, unaffected by the current filter. */
  totals: {
    all: number
    active: number
    completed: number
    archived: number
    overdue: number
  }
  /** True when there is not a single live goal, as opposed to none matching. */
  empty: boolean
}

export interface GoalsViewOptions {
  filter?: Partial<GoalFilter> | undefined
  sort?: GoalSort | undefined
}

/** The joined rows a summary needs, read once for the whole screen. */
interface GoalWorld {
  today: DateStr
  goals: Goal[]
  milestones: Milestone[]
  projects: Project[]
  tasks: Task[]
}

async function readWorld(): Promise<GoalWorld> {
  const [goals, milestones, projects, tasks] = await Promise.all([
    goalRepo.listLive(),
    milestoneRepo.listLive(),
    projectRepo.list(),
    taskRepo.list(),
  ])

  return {
    today: platform.clock.today(),
    goals,
    milestones,
    projects,
    // Recurrence templates are not work anybody has to do; they are the recipe.
    tasks: tasks.filter((task) => !task.isTemplate),
  }
}

/**
 * Every task related to one goal, by both routes the model provides — through a
 * milestone of the goal, or through a project linked to it — counted once.
 *
 * This is the only definition of "related task" in the application, so the
 * progress bar, the detail view and the dashboard all mean the same thing by it.
 */
function relatedTasks(goal: Goal, world: GoalWorld): Task[] {
  const milestoneIds = new Set(milestonesOf(goal.id, world.milestones).map((row) => row.id))
  const projectIds = new Set(
    // An archived project is work the user has stopped tracking. Counting its
    // tasks would let an abandoned project hold a goal below 100 % for good —
    // the same reason a soft-deleted milestone never counts. A *completed*
    // project does count: its tasks are finished, and that is real progress.
    goalProjects(goal, world).map((project) => project.id),
  )

  return world.tasks.filter(
    (task) =>
      (task.milestoneId !== null && milestoneIds.has(task.milestoneId)) ||
      (task.projectId !== null && projectIds.has(task.projectId)),
  )
}

/** Live, non-archived projects supporting a goal. */
function goalProjects(goal: Goal, world: GoalWorld): Project[] {
  return world.projects.filter(
    (project) => project.goalId === goal.id && project.status !== 'archived',
  )
}

function buildItem(goal: Goal, world: GoalWorld): GoalListItem {
  const milestones = milestonesOf(goal.id, world.milestones)
  const tasks = relatedTasks(goal, world)

  const milestoneViews: MilestoneView[] = milestones.map((milestone) => ({
    milestone,
    tasks: calculateMilestoneProgress(milestone.id, world.tasks),
    overdue: isMilestoneOverdue(milestone, world.today),
  }))

  return {
    goal,
    progress: calculateGoalProgress(goal, world.milestones, tasks),
    milestones: progressOf(milestones.filter((row) => row.done).length, milestones.length),
    tasks: calculateGoalTaskProgress(tasks),
    health: getGoalHealth(goal, world.today),
    overdueMilestones: milestoneViews.filter((view) => view.overdue).length,
    milestoneViews,
    projects: goalProjects(goal, world),
  }
}

export async function getGoalsView(options: GoalsViewOptions = {}): Promise<GoalsViewData> {
  const world = await readWorld()
  const filter: GoalFilter = { ...DEFAULT_GOAL_FILTER, ...options.filter }

  const all = world.goals.map((goal) => buildItem(goal, world))
  const visible = sortGoals(filterGoals(all, filter), options.sort ?? 'manual') as GoalListItem[]

  return {
    today: world.today,
    goals: visible,
    totals: {
      all: all.length,
      active: all.filter((item) => isGoalActive(item.goal)).length,
      completed: all.filter((item) => isGoalCompleted(item.goal)).length,
      archived: all.filter((item) => isGoalArchived(item.goal)).length,
      overdue: all.filter((item) => item.health === 'overdue').length,
    },
    empty: all.length === 0,
  }
}

export interface GoalDetailData extends GoalListItem {
  /** The clock port's local day, so the panel never reads a clock itself. */
  today: DateStr
  /** Related tasks, so the detail view can show the work behind the numbers. */
  relatedTasks: Task[]
  /** Related tasks with no milestone — work under the goal but no checkpoint. */
  unassignedTasks: Task[]
}

export async function getGoalDetail(id: Id): Promise<GoalDetailData | undefined> {
  const world = await readWorld()
  const goal = world.goals.find((row) => row.id === id)
  if (!goal) return undefined

  const item = buildItem(goal, world)
  const tasks = relatedTasks(goal, world)
  const milestoneIds = new Set(item.milestoneViews.map((view) => view.milestone.id))

  return {
    ...item,
    today: world.today,
    relatedTasks: tasks,
    unassignedTasks: tasks.filter(
      (task) => task.milestoneId === null || !milestoneIds.has(task.milestoneId),
    ),
  }
}

/** Live tasks under one milestone, for the detail view's checkpoint list. */
export async function getMilestoneTasks(milestoneId: Id): Promise<Task[]> {
  const tasks = await milestoneRepo.tasksFor(milestoneId)
  return tasks.filter((task) => !task.isTemplate)
}

// ------------------------------------------------------------------ dashboard

export interface DashboardGoal {
  id: Id
  title: string
  progress: Progress
  health: GoalHealth
  targetDate: DateStr | null
  /** Which figure the percentage came from, so the card can say so. */
  basis: 'milestones' | 'tasks' | 'none'
}

export interface GoalDashboardSummary {
  today: DateStr
  /** Active goals only, most urgent first. Capped for the card. */
  goals: DashboardGoal[]
  activeCount: number
  completedCount: number
  overdueCount: number
}

export const DASHBOARD_GOAL_LIMIT = 4

/**
 * The Dashboard's slice of the goal data.
 *
 * Built from `getGoalsView`, so every number on the card is the number the
 * Goals page shows. Ordering is deadline-first — a goal with a date the user
 * chose is more pressing than one without — and every tie falls through to the
 * shared stable comparator, so the card never reshuffles between renders.
 */
export async function getGoalDashboard(): Promise<GoalDashboardSummary> {
  const view = await getGoalsView({ filter: { state: 'active' }, sort: 'deadline' })

  return {
    today: view.today,
    goals: view.goals.slice(0, DASHBOARD_GOAL_LIMIT).map((item) => ({
      id: item.goal.id,
      title: item.goal.title,
      progress: item.progress,
      health: item.health,
      targetDate: item.goal.targetDate,
      basis: item.milestones.total > 0 ? 'milestones' : item.tasks.total > 0 ? 'tasks' : 'none',
    })),
    activeCount: view.totals.active,
    completedCount: view.totals.completed,
    overdueCount: view.totals.overdue,
  }
}
