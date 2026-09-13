import type { DateStr, Goal, Milestone, Task } from '@/types/entities'
import type { GoalStatus } from '@/types/enums'

/**
 * What a goal is worth, as pure functions.
 *
 * Nothing here touches Dexie, React or a clock: every answer is derived from
 * rows and a date handed in. That is what makes "what is this goal's progress?"
 * a plain assertion rather than something you have to click through a UI to
 * find out — and it is why the Goals list, the Goal detail and the Dashboard
 * cannot disagree, because all three call these.
 *
 * ---------------------------------------------------------------------------
 * The model this reads, and the relationships it does NOT invent
 *
 * The M1 domain already connects these three, so M8 adds no fields:
 *
 *   Milestone.goalId   — a milestone belongs to exactly one goal
 *   Task.milestoneId   — a task may point at exactly one milestone
 *   Project.goalId     — a project may support one goal
 *
 * A task therefore relates to a goal **transitively**, through its milestone,
 * or through a project linked to the goal. There is deliberately no
 * `Task.goalId`: a second path from task to goal is a second thing to keep in
 * step, and the inconsistent state it makes possible — a task pointing at goal
 * A while its milestone belongs to goal B — simply cannot be expressed here.
 * Integrity is a property of the shape, not of a validation rule.
 */

// ------------------------------------------------------------------ statuses

/**
 * How the model's four statuses map onto the three things a user does.
 *
 * `GoalStatus` is `active | paused | achieved | dropped` and there is no
 * `archivedAt` column, so "archive" is stored as `dropped` — the model's own
 * word for a goal no longer being pursued. Nothing new is persisted.
 */
export const GOAL_ACTIVE_STATUSES: GoalStatus[] = ['active', 'paused']
export const GOAL_COMPLETED_STATUS: GoalStatus = 'achieved'
export const GOAL_ARCHIVED_STATUS: GoalStatus = 'dropped'

export function isGoalActive(goal: Goal): boolean {
  return goal.deletedAt === null && GOAL_ACTIVE_STATUSES.includes(goal.status)
}

export function isGoalCompleted(goal: Goal): boolean {
  return goal.status === GOAL_COMPLETED_STATUS
}

export function isGoalArchived(goal: Goal): boolean {
  return goal.status === GOAL_ARCHIVED_STATUS
}

// ------------------------------------------------------------------ progress

export interface Progress {
  done: number
  total: number
  /** Whole percent, 0–100. Nothing to measure reads 0, never NaN. */
  percent: number
}

export const NO_PROGRESS: Progress = { done: 0, total: 0, percent: 0 }

/**
 * Rounds toward the truth at both ends: anything outstanding never reads 100 %,
 * and anything finished never reads 0 %. The same rule M4 uses for projects, so
 * a bar means the same thing everywhere in the application.
 */
export function progressOf(done: number, total: number): Progress {
  if (total <= 0) return NO_PROGRESS
  if (done <= 0) return { done, total, percent: 0 }
  if (done >= total) return { done: total, total, percent: 100 }
  return { done, total, percent: Math.min(99, Math.max(1, Math.round((done / total) * 100))) }
}

/** Live milestones of a goal, in manual order. Deleted ones never count. */
export function milestonesOf(goalId: string, milestones: Milestone[]): Milestone[] {
  return milestones
    .filter((row) => row.deletedAt === null && row.goalId === goalId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
}

/**
 * A goal's own progress — the canonical rule.
 *
 *   1. If the goal has live milestones, progress is
 *      completed milestones / total milestones.
 *   2. Otherwise, if any task relates to the goal, progress is
 *      completed tasks / total tasks.
 *   3. Otherwise 0 %.
 *
 * Milestones win when they exist, and that is the whole point. A goal is an
 * outcome, and its milestones are the checkpoints someone deliberately chose to
 * measure it by; tasks are the day-to-day work. Blending the two — or letting
 * tasks vote — means a goal with a hundred small chores drifts to 90 % while
 * every meaningful checkpoint is still open. The task figure is still computed
 * and shown, but as *supporting* information, never as the headline.
 *
 * Deleted milestones and deleted tasks are excluded by the callers that build
 * these lists, so nothing removed can inflate a number.
 */
export function calculateGoalProgress(
  goal: Goal,
  milestones: Milestone[],
  relatedTasks: Task[],
): Progress {
  const own = milestonesOf(goal.id, milestones)

  if (own.length > 0) {
    return progressOf(own.filter((milestone) => milestone.done).length, own.length)
  }

  if (relatedTasks.length > 0) {
    return calculateGoalTaskProgress(relatedTasks)
  }

  return NO_PROGRESS
}

/** The supporting figure: how much of the related work is done. */
export function calculateGoalTaskProgress(relatedTasks: Task[]): Progress {
  const live = relatedTasks.filter((task) => task.deletedAt === null && !task.isTemplate)
  return progressOf(live.filter((task) => task.status === 'done').length, live.length)
}

/**
 * One milestone's task progress.
 *
 * Reported alongside the milestone's own `done` flag rather than replacing it:
 * a milestone marked complete **is** complete, whatever its tasks say. Someone
 * who ticks "Finish Trees" has decided the checkpoint is met, and having a
 * later task reopen quietly undo that decision would make the flag worthless.
 */
export function calculateMilestoneProgress(milestoneId: string, tasks: Task[]): Progress {
  const own = tasks.filter(
    (task) => task.deletedAt === null && !task.isTemplate && task.milestoneId === milestoneId,
  )
  return progressOf(own.filter((task) => task.status === 'done').length, own.length)
}

// -------------------------------------------------------------------- health

/**
 * How a goal stands against its own deadline.
 *
 * Deliberately four flat states and no prediction. Note that this is a *goal*
 * concept: it reads `Goal.targetDate` and the goal's own status, and knows
 * nothing about whether its tasks are late. A goal due in March is not overdue
 * because a task inside it slipped last Tuesday, and a task is not overdue
 * because its goal is — the two live on different clocks and M3's task rules
 * are untouched.
 */
export type GoalHealth = 'completed' | 'overdue' | 'on-track' | 'no-deadline'

export function getGoalHealth(goal: Goal, today: DateStr): GoalHealth {
  if (isGoalCompleted(goal)) return 'completed'
  if (goal.targetDate === null) return 'no-deadline'
  return goal.targetDate < today ? 'overdue' : 'on-track'
}

/** True for a milestone that is still open and past its own target date. */
export function isMilestoneOverdue(milestone: Milestone, today: DateStr): boolean {
  return !milestone.done && milestone.targetDate !== null && milestone.targetDate < today
}

// ------------------------------------------------------------------- sorting

export type GoalSort = 'manual' | 'deadline' | 'progress' | 'created' | 'name'

export const GOAL_SORTS: { id: GoalSort; label: string }[] = [
  { id: 'manual', label: 'Manual order' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'progress', label: 'Progress' },
  { id: 'created', label: 'Created' },
  { id: 'name', label: 'Name' },
]

/** A goal plus everything derived from it. What a row renders. */
export interface GoalSummary {
  goal: Goal
  progress: Progress
  /** Milestone counts, even when tasks supplied the headline figure. */
  milestones: Progress
  /** Supporting statistic — never the headline when milestones exist. */
  tasks: Progress
  health: GoalHealth
  /** Live milestones past their own target date and still open. */
  overdueMilestones: number
}

/**
 * Every comparison ends in `id`, so no two distinct goals can ever compare
 * equal and the order can never depend on what the database happened to return
 * first. The same total-order discipline the Dashboard's Next Action uses.
 */
function stable(a: GoalSummary, b: GoalSummary): number {
  return (
    a.goal.sortOrder - b.goal.sortOrder ||
    a.goal.createdAt - b.goal.createdAt ||
    (a.goal.id < b.goal.id ? -1 : a.goal.id > b.goal.id ? 1 : 0)
  )
}

/** Sorts a copy — a live query hands the same array to several consumers. */
export function sortGoals(summaries: GoalSummary[], sort: GoalSort): GoalSummary[] {
  const rows = [...summaries]

  switch (sort) {
    case 'manual':
      return rows.sort(stable)
    case 'deadline':
      // Undated goals sort last in both directions: no deadline is not "the
      // year 0", exactly as undated tasks behave in M3.
      return rows.sort((a, b) => {
        const left = a.goal.targetDate
        const right = b.goal.targetDate
        if (left !== right) {
          if (left === null) return 1
          if (right === null) return -1
          return left < right ? -1 : 1
        }
        return stable(a, b)
      })
    case 'progress':
      return rows.sort((a, b) => b.progress.percent - a.progress.percent || stable(a, b))
    case 'created':
      return rows.sort((a, b) => b.goal.createdAt - a.goal.createdAt || stable(a, b))
    case 'name':
      return rows.sort((a, b) => a.goal.title.localeCompare(b.goal.title) || stable(a, b))
  }
}

// ----------------------------------------------------------------- filtering

export type GoalStateFilter = 'active' | 'completed' | 'archived' | 'all'
export type GoalHealthFilter = 'any' | 'overdue' | 'on-track'

export interface GoalFilter {
  state: GoalStateFilter
  health: GoalHealthFilter
  search: string
}

export const DEFAULT_GOAL_FILTER: GoalFilter = {
  state: 'active',
  health: 'any',
  search: '',
}

/** Title and the `why` field — the model's description. Every term required. */
export function matchesGoalSearch(goal: Goal, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const text = `${goal.title}   ${goal.why ?? ''}`.toLowerCase()
  return terms.every((term) => text.includes(term))
}

function matchesState(goal: Goal, state: GoalStateFilter): boolean {
  switch (state) {
    case 'all':
      return true
    case 'active':
      return isGoalActive(goal)
    case 'completed':
      return isGoalCompleted(goal)
    case 'archived':
      return isGoalArchived(goal)
  }
}

export function filterGoals(summaries: GoalSummary[], filter: GoalFilter): GoalSummary[] {
  const search = filter.search.trim()

  return summaries.filter(({ goal, health }) => {
    if (!matchesState(goal, filter.state)) return false
    if (filter.health === 'overdue' && health !== 'overdue') return false
    if (filter.health === 'on-track' && health !== 'on-track') return false
    if (search.length > 0 && !matchesGoalSearch(goal, search)) return false
    return true
  })
}
