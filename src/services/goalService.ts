import { orderAfterLast, orderForMove } from '@/lib/sortOrder'
import { platform } from '@/platform'
import { goalRepo, milestoneRepo, projectRepo, taskRepo } from '@/repositories'
import type { DateStr, Goal, Id, Milestone, Task } from '@/types/entities'
import type { EventSource, GoalHorizon } from '@/types/enums'
import { eventBus } from './eventBus'
import {
  GOAL_ARCHIVED_STATUS,
  GOAL_COMPLETED_STATUS,
  isGoalArchived,
  isGoalCompleted,
} from './goals/goalStats'
import { updateTask } from './taskService'

/**
 * Everything that writes a goal or a milestone.
 *
 * Three rules carry most of the weight here, and all three exist because the
 * alternative silently destroys information:
 *
 *  1. **Nothing cascades into tasks.** Completing a goal, archiving it or
 *     deleting it never completes, reschedules or deletes a single task. A goal
 *     is an outcome; a task is an action someone still has to perform, and
 *     declaring the outcome finished does not perform them.
 *
 *  2. **Configuration is not history.** Renaming a goal, moving its deadline or
 *     archiving it never rewrites which milestones were completed or when. The
 *     goal says what is intended now; `done` and `completedAt` say what
 *     happened. This is the same separation habits keep between a schedule and
 *     its entries.
 *
 *  3. **Tasks are written by TaskService, never here.** Assigning a task to a
 *     milestone goes through `updateTask`, so it emits the events the rest of
 *     the app already listens for, and there is exactly one function in the
 *     codebase that writes a task row.
 */

export interface GoalWriteOptions {
  source?: EventSource
}

export interface GoalInput {
  title: string
  why?: string | null | undefined
  horizon?: GoalHorizon | undefined
  targetDate?: DateStr | null | undefined
  sortOrder?: number | undefined
}

export type GoalPatch = Partial<Pick<Goal, 'title' | 'why' | 'horizon' | 'targetDate'>>

export interface MilestoneInput {
  title: string
  targetDate?: DateStr | null | undefined
  sortOrder?: number | undefined
}

export type MilestonePatch = Partial<Pick<Milestone, 'title' | 'targetDate'>>

export class EmptyGoalTitleError extends Error {
  constructor() {
    super('A goal needs a title')
    this.name = 'EmptyGoalTitleError'
  }
}

export class EmptyMilestoneTitleError extends Error {
  constructor() {
    super('A milestone needs a title')
    this.name = 'EmptyMilestoneTitleError'
  }
}

/**
 * Raised when a task is pointed at a milestone belonging to a different goal
 * than the one the caller named.
 *
 * In practice this is unreachable through the UI, because a task stores only
 * `milestoneId` and the milestone alone determines the goal — there is no
 * second pointer that could disagree. It exists so that a caller who passes an
 * explicit `goalId` gets told when their two arguments contradict each other,
 * rather than having one of them silently ignored.
 */
export class MilestoneGoalMismatchError extends Error {
  readonly milestoneId: Id
  readonly goalId: Id

  constructor(milestoneId: Id, goalId: Id) {
    super('That milestone belongs to a different goal')
    this.name = 'MilestoneGoalMismatchError'
    this.milestoneId = milestoneId
    this.goalId = goalId
  }
}

const clean = (value: string) => value.trim().replace(/\s+/g, ' ')

function assertGoalTitle(title: string): string {
  const cleaned = clean(title)
  if (cleaned.length === 0) throw new EmptyGoalTitleError()
  return cleaned
}

function assertMilestoneTitle(title: string): string {
  const cleaned = clean(title)
  if (cleaned.length === 0) throw new EmptyMilestoneTitleError()
  return cleaned
}

// --------------------------------------------------------------------- reads

export function listGoals(): Promise<Goal[]> {
  return goalRepo.listLive()
}

export function getGoal(id: Id): Promise<Goal | undefined> {
  return goalRepo.get(id)
}

export function listMilestones(goalId: Id): Promise<Milestone[]> {
  return milestoneRepo.byGoal(goalId)
}

export function getMilestone(id: Id): Promise<Milestone | undefined> {
  return milestoneRepo.get(id)
}

/**
 * Every task related to a goal, by both routes the model provides: through a
 * milestone of the goal, and through a project linked to the goal.
 *
 * De-duplicated by id, because a task assigned to a milestone *and* sitting in
 * a goal-linked project is one task, not two — counting it twice would make a
 * progress bar report more work than exists.
 */
export async function listGoalTasks(goalId: Id): Promise<Task[]> {
  const [milestones, projects] = await Promise.all([
    milestoneRepo.byGoal(goalId),
    projectRepo.list(),
  ])

  const milestoneIds = new Set(milestones.map((row) => row.id))
  const projectIds = new Set(
    projects.filter((project) => project.goalId === goalId).map((project) => project.id),
  )
  if (milestoneIds.size === 0 && projectIds.size === 0) return []

  const tasks = await taskRepo.list()
  return tasks.filter(
    (task) =>
      !task.isTemplate &&
      ((task.milestoneId !== null && milestoneIds.has(task.milestoneId)) ||
        (task.projectId !== null && projectIds.has(task.projectId))),
  )
}

// -------------------------------------------------------------- goal writes

export async function createGoal(
  title: string,
  options: Omit<GoalInput, 'title'> = {},
  source: EventSource = 'ui',
): Promise<Goal> {
  return goalRepo.create(
    {
      title: assertGoalTitle(title),
      why: options.why ?? null,
      horizon: options.horizon ?? 'long',
      status: 'active',
      targetDate: options.targetDate ?? null,
      sortOrder: options.sortOrder ?? orderAfterLast(await goalRepo.lastOrder()),
      vaultPath: null,
    },
    { source },
  )
}

/**
 * Applies a patch to a goal.
 *
 * Nothing below reads or writes a milestone or a task. Renaming a goal or
 * pulling its deadline forward changes what the goal *is*, and leaves entirely
 * untouched the record of which checkpoints were met and when — which is the
 * only reason last month's progress still means what it said last month.
 */
export async function updateGoal(
  id: Id,
  patch: GoalPatch,
  options: GoalWriteOptions = {},
): Promise<Goal> {
  const source: EventSource = options.source ?? 'ui'
  const current = await goalRepo.getOrThrow(id)

  const next: GoalPatch = { ...patch }
  if (typeof next.title === 'string') next.title = assertGoalTitle(next.title)

  const changed = (Object.keys(next) as (keyof GoalPatch)[]).filter(
    (field) => current[field] !== next[field],
  )
  if (changed.length === 0) return current

  return goalRepo.update(id, next, { source })
}

/**
 * Marks the outcome reached.
 *
 * Deliberately a status change and nothing else: no milestone is ticked and no
 * task is completed. Someone who declares a goal achieved with two checkpoints
 * still open means exactly that, and the progress bar goes on reporting what
 * the milestones actually say.
 */
export async function completeGoal(id: Id, options: GoalWriteOptions = {}): Promise<Goal> {
  const source: EventSource = options.source ?? 'ui'
  const current = await goalRepo.getOrThrow(id)
  if (isGoalCompleted(current)) return current

  const [milestones, tasks] = await Promise.all([
    milestoneRepo.byGoal(id),
    listGoalTasks(id),
  ])

  const updated = await goalRepo.update(
    id,
    { status: GOAL_COMPLETED_STATUS },
    { source, emit: false },
  )

  await eventBus.emit({
    type: 'goal.completed',
    entityType: 'goal',
    entityId: id,
    source,
    payload: {
      title: updated.title,
      // Recorded so the log shows what was still open at the moment it was
      // called done — the counts, never a change to the rows themselves.
      openMilestones: milestones.filter((row) => !row.done).length,
      openTasks: tasks.filter((task) => task.status !== 'done').length,
    },
  })

  return updated
}

/** Puts a completed or archived goal back into active pursuit. */
export async function reopenGoal(id: Id, options: GoalWriteOptions = {}): Promise<Goal> {
  const source: EventSource = options.source ?? 'ui'
  const current = await goalRepo.getOrThrow(id)
  if (current.status === 'active') return current

  const from = current.status
  const updated = await goalRepo.update(id, { status: 'active' }, { source, emit: false })

  await eventBus.emit({
    type: 'goal.reopened',
    entityType: 'goal',
    entityId: id,
    source,
    payload: { title: updated.title, from },
  })

  return updated
}

/**
 * Stops pursuing a goal without losing anything.
 *
 * Stored as the model's own `dropped` status rather than a new `archivedAt`
 * column: the M1 schema already has a word for this, and adding a second flag
 * that means the same thing is how two sources of truth start. Milestones and
 * tasks are untouched — an archived goal that comes back brings its whole
 * structure with it.
 */
export async function archiveGoal(id: Id, options: GoalWriteOptions = {}): Promise<Goal> {
  const source: EventSource = options.source ?? 'ui'
  const current = await goalRepo.getOrThrow(id)
  if (isGoalArchived(current)) return current

  const milestones = await milestoneRepo.byGoal(id)
  const updated = await goalRepo.update(
    id,
    { status: GOAL_ARCHIVED_STATUS },
    { source, emit: false },
  )

  await eventBus.emit({
    type: 'goal.archived',
    entityType: 'goal',
    entityId: id,
    source,
    payload: { title: updated.title, milestoneCount: milestones.length },
  })

  return updated
}

export function unarchiveGoal(id: Id, options: GoalWriteOptions = {}): Promise<Goal> {
  return reopenGoal(id, options)
}

export interface GoalDeletion {
  goal: Goal
  /** Milestones left in place, so restoring the goal restores its structure. */
  retainedMilestoneCount: number
  /** Tasks left in place. Deleting a goal never deletes work. */
  retainedTaskCount: number
}

/**
 * Soft delete.
 *
 * The goal row is stamped; its milestones and tasks are left exactly as they
 * were. That is what makes restore reversible — the milestones still point at
 * the goal id, so the goal comes back whole — and it is why deleting a goal can
 * never cost you a task you still have to do.
 */
export async function deleteGoal(
  id: Id,
  options: GoalWriteOptions = {},
): Promise<GoalDeletion> {
  const source: EventSource = options.source ?? 'ui'
  const goal = await goalRepo.getOrThrow(id)
  const [milestones, tasks] = await Promise.all([milestoneRepo.byGoal(id), listGoalTasks(id)])

  await goalRepo.softDelete(id, { source })

  return {
    goal: { ...goal, deletedAt: platform.clock.now() },
    retainedMilestoneCount: milestones.length,
    retainedTaskCount: tasks.length,
  }
}

export function restoreGoal(id: Id, options: GoalWriteOptions = {}): Promise<Goal> {
  return goalRepo.restore(id, { source: options.source ?? 'ui' })
}

// --------------------------------------------------------- milestone writes

/**
 * Adds a checkpoint to a goal.
 *
 * The goal is read first and not merely referenced, so a milestone can never be
 * created against a goal that does not exist. Combined with the non-nullable
 * `goalId` in the model, that leaves no way to produce an orphan milestone.
 */
export async function createMilestone(
  goalId: Id,
  title: string,
  options: Omit<MilestoneInput, 'title'> = {},
  source: EventSource = 'ui',
): Promise<Milestone> {
  await goalRepo.getOrThrow(goalId)

  return milestoneRepo.create(
    {
      goalId,
      title: assertMilestoneTitle(title),
      targetDate: options.targetDate ?? null,
      done: false,
      sortOrder: options.sortOrder ?? orderAfterLast(await milestoneRepo.lastOrder(goalId)),
    },
    { source },
  )
}

/**
 * Edits a milestone's title or target date.
 *
 * `goalId` and `done` are deliberately outside `MilestonePatch`. A milestone
 * cannot be moved between goals — that would silently reassign every task
 * pointing at it — and completion has its own function so that it emits the
 * event that means "a checkpoint was met" rather than a generic update.
 */
export async function updateMilestone(
  id: Id,
  patch: MilestonePatch,
  options: GoalWriteOptions = {},
): Promise<Milestone> {
  const source: EventSource = options.source ?? 'ui'
  const current = await milestoneRepo.getOrThrow(id)

  const next: MilestonePatch = { ...patch }
  if (typeof next.title === 'string') next.title = assertMilestoneTitle(next.title)

  const changed = (Object.keys(next) as (keyof MilestonePatch)[]).filter(
    (field) => current[field] !== next[field],
  )
  if (changed.length === 0) return current

  return milestoneRepo.update(id, next, { source })
}

/**
 * Ticks a checkpoint.
 *
 * Its tasks are **not** completed. A checkpoint being met is a judgement the
 * user makes; whether every task under it is finished is a separate fact, and
 * the detail view shows both. Completing the milestone here and the tasks too
 * would make "5 of 7 tasks" impossible to express.
 */
export async function completeMilestone(
  id: Id,
  options: GoalWriteOptions = {},
): Promise<Milestone> {
  const source: EventSource = options.source ?? 'ui'
  const current = await milestoneRepo.getOrThrow(id)
  if (current.done) return current

  const openTasks = (await milestoneRepo.tasksFor(id)).filter((task) => task.status !== 'done')
  const updated = await milestoneRepo.update(id, { done: true }, { source, emit: false })

  await eventBus.emit({
    type: 'milestone.completed',
    entityType: 'milestone',
    entityId: id,
    source,
    payload: { title: updated.title, goalId: updated.goalId, openTasks: openTasks.length },
  })

  return updated
}

/** Reopens a checkpoint. Its tasks are likewise untouched. */
export async function reopenMilestone(
  id: Id,
  options: GoalWriteOptions = {},
): Promise<Milestone> {
  const source: EventSource = options.source ?? 'ui'
  const current = await milestoneRepo.getOrThrow(id)
  if (!current.done) return current

  const updated = await milestoneRepo.update(id, { done: false }, { source, emit: false })

  await eventBus.emit({
    type: 'milestone.reopened',
    entityType: 'milestone',
    entityId: id,
    source,
    payload: { title: updated.title, goalId: updated.goalId },
  })

  return updated
}

export async function toggleMilestone(
  id: Id,
  options: GoalWriteOptions = {},
): Promise<Milestone> {
  const current = await milestoneRepo.getOrThrow(id)
  return current.done ? reopenMilestone(id, options) : completeMilestone(id, options)
}

export interface MilestoneDeletion {
  milestone: Milestone
  /** Tasks that kept pointing at it, so restoring re-attaches them. */
  retainedTaskCount: number
}

/**
 * Soft-deletes a milestone.
 *
 * Its tasks keep their `milestoneId` rather than being unlinked. Clearing the
 * pointer would be a second, irreversible mutation hidden inside a reversible
 * one: restoring the milestone could not know which tasks to re-attach. The
 * tasks simply stop appearing under a checkpoint that is no longer there, and
 * come back with it. They are never completed and never deleted.
 */
export async function deleteMilestone(
  id: Id,
  options: GoalWriteOptions = {},
): Promise<MilestoneDeletion> {
  const source: EventSource = options.source ?? 'ui'
  const milestone = await milestoneRepo.getOrThrow(id)
  const retained = await milestoneRepo.countTasks(id)

  await milestoneRepo.softDelete(id, { source })

  return {
    milestone: { ...milestone, deletedAt: platform.clock.now() },
    retainedTaskCount: retained,
  }
}

export function restoreMilestone(
  id: Id,
  options: GoalWriteOptions = {},
): Promise<Milestone> {
  return milestoneRepo.restore(id, { source: options.source ?? 'ui' })
}

// ------------------------------------------------------- task ↔ goal linking

/**
 * Points a task at a milestone, or clears it with `null`.
 *
 * The write itself is `updateTask` — this function validates and delegates. It
 * never touches a task row directly, so a task assigned from the goal screen
 * emits the same events, and passes through the same rules, as one edited from
 * anywhere else in the application.
 *
 * `expectedGoalId` is optional and exists only to catch a caller whose two
 * arguments disagree. The relationship itself needs no repair pass: a task
 * reaches its goal *through* the milestone, so a task pointing at a milestone
 * of another goal is not a state the schema can represent.
 */
export async function assignTaskToMilestone(
  taskId: Id,
  milestoneId: Id | null,
  options: GoalWriteOptions & { expectedGoalId?: Id } = {},
): Promise<Task> {
  const source: EventSource = options.source ?? 'ui'

  if (milestoneId !== null) {
    const milestone = await milestoneRepo.getOrThrow(milestoneId)
    // The parent goal must exist and be live; a milestone under a deleted goal
    // is not somewhere new work should be filed.
    await goalRepo.getOrThrow(milestone.goalId)

    if (options.expectedGoalId !== undefined && milestone.goalId !== options.expectedGoalId) {
      throw new MilestoneGoalMismatchError(milestoneId, options.expectedGoalId)
    }
  }

  return updateTask(taskId, { milestoneId }, { source })
}

/** Which goal a task belongs to, if any — resolved through its milestone. */
export async function goalIdForTask(task: Task): Promise<Id | null> {
  if (task.milestoneId === null) return null
  const milestone = await milestoneRepo.get(task.milestoneId)
  return milestone?.goalId ?? null
}

// ------------------------------------------------------------------ ordering

export async function moveGoal(
  orderedIds: Id[],
  fromIndex: number,
  toIndex: number,
  options: GoalWriteOptions = {},
): Promise<Goal | undefined> {
  const id = orderedIds[fromIndex]
  if (!id || fromIndex === toIndex) return undefined

  const source: EventSource = options.source ?? 'ui'
  const rows = await Promise.all(orderedIds.map((goalId) => goalRepo.get(goalId)))
  const present = rows.filter((row): row is Goal => row !== undefined)
  if (present.length !== orderedIds.length) return undefined

  const orders = present.map((goal) => goal.sortOrder)
  const sortOrder = orderForMove(orders, fromIndex, toIndex)

  if (!Number.isFinite(sortOrder) || hasCollision(orders, sortOrder, fromIndex)) {
    const respaced = await respaceGoals(present)
    return applyGoalOrder(
      id,
      orderForMove(
        respaced.map((goal) => goal.sortOrder),
        fromIndex,
        toIndex,
      ),
      source,
    )
  }

  return applyGoalOrder(id, sortOrder, source)
}

/**
 * Reorders the milestones of one goal.
 *
 * Writes `Milestone.sortOrder` and nothing else. Task ordering is a separate
 * list with its own `sortOrder`, and rearranging checkpoints must not shuffle
 * anybody's task list underneath them.
 */
export async function moveMilestone(
  goalId: Id,
  orderedIds: Id[],
  fromIndex: number,
  toIndex: number,
  options: GoalWriteOptions = {},
): Promise<Milestone | undefined> {
  const id = orderedIds[fromIndex]
  if (!id || fromIndex === toIndex) return undefined

  const source: EventSource = options.source ?? 'ui'
  const rows = await milestoneRepo.byGoal(goalId)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const present = orderedIds
    .map((milestoneId) => byId.get(milestoneId))
    .filter((row): row is Milestone => row !== undefined)
  if (present.length !== orderedIds.length) return undefined

  const orders = present.map((milestone) => milestone.sortOrder)
  const sortOrder = orderForMove(orders, fromIndex, toIndex)

  if (!Number.isFinite(sortOrder) || hasCollision(orders, sortOrder, fromIndex)) {
    const respaced = await respaceMilestones(present)
    return applyMilestoneOrder(
      id,
      orderForMove(
        respaced.map((milestone) => milestone.sortOrder),
        fromIndex,
        toIndex,
      ),
      source,
    )
  }

  return applyMilestoneOrder(id, sortOrder, source)
}

function hasCollision(orders: number[], candidate: number, skipIndex: number): boolean {
  return orders.some((order, index) => index !== skipIndex && order === candidate)
}

async function applyGoalOrder(id: Id, sortOrder: number, source: EventSource): Promise<Goal> {
  const updated = await goalRepo.update(id, { sortOrder }, { source, emit: false })
  await eventBus.emit({
    type: 'goal.reordered',
    entityType: 'goal',
    entityId: id,
    source,
    payload: { sortOrder },
  })
  return updated
}

async function applyMilestoneOrder(
  id: Id,
  sortOrder: number,
  source: EventSource,
): Promise<Milestone> {
  const updated = await milestoneRepo.update(id, { sortOrder }, { source, emit: false })
  await eventBus.emit({
    type: 'milestone.reordered',
    entityType: 'milestone',
    entityId: id,
    source,
    payload: { sortOrder },
  })
  return updated
}

async function respaceGoals(goals: Goal[]): Promise<Goal[]> {
  const orders = goals.map((goal, index) => ({ id: goal.id, sortOrder: (index + 1) * 1000 }))
  await goalRepo.respaceOrders(orders)
  return goals.map((goal, index) => ({ ...goal, sortOrder: (index + 1) * 1000 }))
}

async function respaceMilestones(milestones: Milestone[]): Promise<Milestone[]> {
  const orders = milestones.map((row, index) => ({ id: row.id, sortOrder: (index + 1) * 1000 }))
  await milestoneRepo.respaceOrders(orders)
  return milestones.map((row, index) => ({ ...row, sortOrder: (index + 1) * 1000 }))
}
