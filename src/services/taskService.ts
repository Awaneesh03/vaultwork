import { orderAfterLast, orderForMove } from '@/lib/sortOrder'
import { platform } from '@/platform'
import { subtaskRepo, taskRepo } from '@/repositories'
import type { DateStr, Id, Subtask, Task, TimeStr } from '@/types/entities'
import type { EventSource, Priority } from '@/types/enums'
import { eventBus } from './eventBus'

/**
 * Everything that writes a task.
 *
 * Two rules hold throughout:
 *
 *  1. **One mutation, one event.** The base repository emits `task.created`,
 *     `task.updated`, `task.deleted` and `task.restored` inside the same
 *     transaction as the write. Where a domain event is more accurate —
 *     completing, uncompleting, rescheduling, reordering — the repository's
 *     generic event is suppressed with `emit: false` and the specific one is
 *     emitted instead. Completing a task therefore records exactly
 *     `task.completed`, never a `task.updated` alongside it.
 *
 *  2. **Source lives on the event, never on the task.** Every function takes a
 *     `source` and threads it to the log. A task captured from Quick Add and
 *     one typed into the composer are the same row; only their history differs.
 */

export interface TaskWriteOptions {
  source?: EventSource
}

/** A task as the caller describes it: ids already resolved, defaults implied. */
export interface TaskInput {
  title: string
  description?: string | null | undefined
  priority?: Priority | undefined
  dueDate?: DateStr | null | undefined
  dueTime?: TimeStr | null | undefined
  startDate?: DateStr | null | undefined
  estimateMin?: number | null | undefined
  projectId?: Id | null | undefined
  milestoneId?: Id | null | undefined
  tagIds?: Id[] | undefined
  sortOrder?: number | undefined
  /** Created as subtask rows after the task itself. */
  subtasks?: string[] | undefined
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'priority'
    | 'dueDate'
    | 'dueTime'
    | 'startDate'
    | 'estimateMin'
    | 'projectId'
    | 'milestoneId'
    | 'tagIds'
    | 'reminderAt'
  >
>

/** Fields whose change is a *reschedule* rather than a generic edit. */
const SCHEDULING_FIELDS = new Set(['dueDate', 'dueTime', 'startDate', 'reminderAt'])

const clean = (title: string) => title.trim().replace(/\s+/g, ' ')

export class EmptyTaskTitleError extends Error {
  constructor() {
    super('A task needs a title')
    this.name = 'EmptyTaskTitleError'
  }
}

// --------------------------------------------------------------------- reads

export function getTask(id: Id): Promise<Task | undefined> {
  return taskRepo.get(id)
}

export function listSubtasks(taskId: Id): Promise<Subtask[]> {
  return subtaskRepo.byTask(taskId)
}

export interface TaskWithSubtasks {
  task: Task
  subtasks: Subtask[]
}

export async function getTaskWithSubtasks(id: Id): Promise<TaskWithSubtasks | undefined> {
  const task = await taskRepo.get(id)
  if (!task) return undefined
  return { task, subtasks: await subtaskRepo.byTask(id) }
}

// -------------------------------------------------------------------- create

export async function createTask(input: TaskInput, options: TaskWriteOptions = {}): Promise<Task> {
  const title = clean(input.title)
  if (title.length === 0) throw new EmptyTaskTitleError()

  const source: EventSource = options.source ?? 'ui'
  const sortOrder = input.sortOrder ?? orderAfterLast(await taskRepo.lastOrder())

  const task = await taskRepo.create(
    {
      title,
      description: input.description ?? null,
      status: 'todo',
      priority: input.priority ?? 'none',
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      startDate: input.startDate ?? null,
      estimateMin: input.estimateMin ?? null,
      projectId: input.projectId ?? null,
      milestoneId: input.milestoneId ?? null,
      tagIds: input.tagIds ?? [],
      recurrence: null,
      seriesId: null,
      isTemplate: false,
      sortOrder,
      completedAt: null,
      reminderAt: null,
      vaultPath: null,
    },
    { source },
  )

  for (const subtaskTitle of input.subtasks ?? []) {
    if (clean(subtaskTitle).length === 0) continue
    await addSubtask(task.id, subtaskTitle, { source })
  }

  return task
}

// -------------------------------------------------------------------- update

/**
 * Applies a patch and emits the one event that describes it.
 *
 * A patch that changes nothing writes nothing: re-saving a form you did not
 * edit should not add a row to a log that analytics is computed from.
 */
export async function updateTask(
  id: Id,
  patch: TaskPatch,
  options: TaskWriteOptions = {},
): Promise<Task> {
  const source: EventSource = options.source ?? 'ui'
  const current = await taskRepo.getOrThrow(id)

  const next: TaskPatch = { ...patch }
  if (typeof next.title === 'string') {
    const title = clean(next.title)
    if (title.length === 0) throw new EmptyTaskTitleError()
    next.title = title
  }

  const changed = (Object.keys(next) as (keyof TaskPatch)[]).filter((field) => {
    const before = current[field]
    const after = next[field]
    if (Array.isArray(before) && Array.isArray(after)) {
      return before.length !== after.length || before.some((value, i) => value !== after[i])
    }
    return before !== after
  })

  if (changed.length === 0) return current

  const scheduleOnly = changed.every((field) => SCHEDULING_FIELDS.has(field))
  const updated = await taskRepo.update(id, next, { source, emit: !scheduleOnly })

  if (scheduleOnly) {
    await eventBus.emit({
      type: 'task.rescheduled',
      entityType: 'task',
      entityId: id,
      source,
      payload: {
        from: { dueDate: current.dueDate, dueTime: current.dueTime },
        to: { dueDate: updated.dueDate, dueTime: updated.dueTime },
      },
    })
  }

  return updated
}

export function rescheduleTask(
  id: Id,
  dueDate: DateStr | null,
  dueTime: TimeStr | null = null,
  options: TaskWriteOptions = {},
): Promise<Task> {
  return updateTask(id, { dueDate, dueTime: dueDate === null ? null : dueTime }, options)
}

export function setTaskPriority(
  id: Id,
  priority: Priority,
  options: TaskWriteOptions = {},
): Promise<Task> {
  return updateTask(id, { priority }, options)
}

export function setTaskTags(id: Id, tagIds: Id[], options: TaskWriteOptions = {}): Promise<Task> {
  return updateTask(id, { tagIds: [...new Set(tagIds)] }, options)
}

export async function addTaskTag(id: Id, tagId: Id, options: TaskWriteOptions = {}): Promise<Task> {
  const task = await taskRepo.getOrThrow(id)
  if (task.tagIds.includes(tagId)) return task
  return setTaskTags(id, [...task.tagIds, tagId], options)
}

export async function removeTaskTag(
  id: Id,
  tagId: Id,
  options: TaskWriteOptions = {},
): Promise<Task> {
  const task = await taskRepo.getOrThrow(id)
  if (!task.tagIds.includes(tagId)) return task
  return setTaskTags(
    id,
    task.tagIds.filter((value) => value !== tagId),
    options,
  )
}

// ---------------------------------------------------------------- completion

/**
 * Completion is idempotent. Completing a done task returns it unchanged and
 * emits nothing, so a double keypress cannot log two completions and inflate
 * next month's chart.
 */
export async function completeTask(id: Id, options: TaskWriteOptions = {}): Promise<Task> {
  const source: EventSource = options.source ?? 'ui'
  const current = await taskRepo.getOrThrow(id)
  if (current.status === 'done') return current

  const completedAt = platform.clock.now()
  const updated = await taskRepo.update(
    id,
    { status: 'done', completedAt },
    { source, emit: false },
  )

  await eventBus.emit({
    type: 'task.completed',
    entityType: 'task',
    entityId: id,
    source,
    at: completedAt,
    payload: {
      title: updated.title,
      priority: updated.priority,
      projectId: updated.projectId,
      dueDate: updated.dueDate,
      estimateMin: updated.estimateMin,
    },
  })

  return updated
}

export async function uncompleteTask(id: Id, options: TaskWriteOptions = {}): Promise<Task> {
  const source: EventSource = options.source ?? 'ui'
  const current = await taskRepo.getOrThrow(id)
  if (current.status === 'todo') return current

  const updated = await taskRepo.update(
    id,
    { status: 'todo', completedAt: null },
    { source, emit: false },
  )

  await eventBus.emit({
    type: 'task.uncompleted',
    entityType: 'task',
    entityId: id,
    source,
    payload: { title: updated.title },
  })

  return updated
}

export async function toggleTask(id: Id, options: TaskWriteOptions = {}): Promise<Task> {
  const current = await taskRepo.getOrThrow(id)
  return current.status === 'done' ? uncompleteTask(id, options) : completeTask(id, options)
}

// ------------------------------------------------------------ delete/restore

/**
 * Soft delete only. The row stays, `deletedAt` is stamped, and the caller gets
 * a task back so it can offer an undo — which is why normal deletion needs no
 * confirmation dialog.
 */
export async function deleteTask(id: Id, options: TaskWriteOptions = {}): Promise<Task> {
  const source: EventSource = options.source ?? 'ui'
  const task = await taskRepo.getOrThrow(id)
  await taskRepo.softDelete(id, { source })
  return { ...task, deletedAt: platform.clock.now() }
}

export function restoreTask(id: Id, options: TaskWriteOptions = {}): Promise<Task> {
  return taskRepo.restore(id, { source: options.source ?? 'ui' })
}

// ----------------------------------------------------------------- ordering

/**
 * Moves a task within an ordered list of ids.
 *
 * One row is written: the moved task's `sortOrder` becomes the midpoint of its
 * new neighbours. The list is only respaced when midpoints have run out of
 * precision, which takes about fifty drops into the same gap.
 */
export async function moveTask(
  orderedIds: Id[],
  fromIndex: number,
  toIndex: number,
  options: TaskWriteOptions = {},
): Promise<Task | undefined> {
  const id = orderedIds[fromIndex]
  if (!id || fromIndex === toIndex) return undefined

  const source: EventSource = options.source ?? 'ui'
  const rows = await Promise.all(orderedIds.map((taskId) => taskRepo.get(taskId)))
  const present = rows.filter((row): row is Task => row !== undefined)
  if (present.length !== orderedIds.length) {
    // The list moved under us; a respace is the honest recovery.
    await respaceTasks(present)
  }

  const orders = present.map((task) => task.sortOrder)
  const sortOrder = orderForMove(orders, fromIndex, toIndex)

  if (!Number.isFinite(sortOrder) || hasCollision(orders, sortOrder, fromIndex)) {
    const respaced = await respaceTasks(present)
    const nextOrder = orderForMove(
      respaced.map((task) => task.sortOrder),
      fromIndex,
      toIndex,
    )
    return applyOrder(id, nextOrder, source)
  }

  return applyOrder(id, sortOrder, source)
}

function hasCollision(orders: number[], candidate: number, skipIndex: number): boolean {
  return orders.some((order, index) => index !== skipIndex && order === candidate)
}

async function applyOrder(id: Id, sortOrder: number, source: EventSource): Promise<Task> {
  const updated = await taskRepo.update(id, { sortOrder }, { source, emit: false })
  await eventBus.emit({
    type: 'task.reordered',
    entityType: 'task',
    entityId: id,
    source,
    payload: { sortOrder },
  })
  return updated
}

/** Respaces a list to 1,000-apart orders without emitting an event per row. */
async function respaceTasks(tasks: Task[]): Promise<Task[]> {
  const orders = tasks.map((task, index) => ({ id: task.id, sortOrder: (index + 1) * 1000 }))
  await taskRepo.respaceOrders(orders)
  return tasks.map((task, index) => ({
    ...task,
    sortOrder: orders[index]?.sortOrder ?? task.sortOrder,
  }))
}

// ----------------------------------------------------------------- subtasks

export async function addSubtask(
  taskId: Id,
  title: string,
  options: TaskWriteOptions = {},
): Promise<Subtask> {
  const clean_ = clean(title)
  if (clean_.length === 0) throw new EmptyTaskTitleError()
  await taskRepo.getOrThrow(taskId)

  return subtaskRepo.create(
    {
      taskId,
      title: clean_,
      done: false,
      sortOrder: orderAfterLast(await subtaskRepo.lastOrder(taskId)),
    },
    { source: options.source ?? 'ui' },
  )
}

export function renameSubtask(
  id: Id,
  title: string,
  options: TaskWriteOptions = {},
): Promise<Subtask> {
  const clean_ = clean(title)
  if (clean_.length === 0) throw new EmptyTaskTitleError()
  return subtaskRepo.update(id, { title: clean_ }, { source: options.source ?? 'ui' })
}

/**
 * Completing a subtask emits `subtask.completed` and nothing else. It does not
 * touch the parent task, and it never emits a task event — the parent's
 * progress is derived at read time, so there is nothing to keep in step.
 */
export async function setSubtaskDone(
  id: Id,
  done: boolean,
  options: TaskWriteOptions = {},
): Promise<Subtask> {
  const source: EventSource = options.source ?? 'ui'
  const current = await subtaskRepo.getOrThrow(id)
  if (current.done === done) return current

  const updated = await subtaskRepo.update(id, { done }, { source, emit: false })
  await eventBus.emit({
    type: done ? 'subtask.completed' : 'subtask.uncompleted',
    entityType: 'subtask',
    entityId: id,
    source,
    payload: { taskId: updated.taskId, title: updated.title },
  })
  return updated
}

export const completeSubtask = (id: Id, options?: TaskWriteOptions) =>
  setSubtaskDone(id, true, options)

export const uncompleteSubtask = (id: Id, options?: TaskWriteOptions) =>
  setSubtaskDone(id, false, options)

export async function toggleSubtask(id: Id, options: TaskWriteOptions = {}): Promise<Subtask> {
  const current = await subtaskRepo.getOrThrow(id)
  return setSubtaskDone(id, !current.done, options)
}

export async function deleteSubtask(id: Id, options: TaskWriteOptions = {}): Promise<Subtask> {
  const current = await subtaskRepo.getOrThrow(id)
  await subtaskRepo.softDelete(id, { source: options.source ?? 'ui' })
  return current
}

export function restoreSubtask(id: Id, options: TaskWriteOptions = {}): Promise<Subtask> {
  return subtaskRepo.restore(id, { source: options.source ?? 'ui' })
}

/** Same single-row midpoint move as tasks, scoped to one parent. */
export async function moveSubtask(
  taskId: Id,
  fromIndex: number,
  toIndex: number,
  options: TaskWriteOptions = {},
): Promise<Subtask | undefined> {
  if (fromIndex === toIndex) return undefined
  const rows = await subtaskRepo.byTask(taskId)
  const moving = rows[fromIndex]
  if (!moving) return undefined

  const sortOrder = orderForMove(
    rows.map((row) => row.sortOrder),
    fromIndex,
    toIndex,
  )

  return subtaskRepo.update(moving.id, { sortOrder }, { source: options.source ?? 'ui' })
}

export interface SubtaskProgress {
  done: number
  total: number
}

export function subtaskProgress(subtasks: Subtask[]): SubtaskProgress {
  return { done: subtasks.filter((s) => s.done).length, total: subtasks.length }
}
