import { beforeEach, describe, expect, it } from 'vitest'
import { eventRepo, subtaskRepo, taskRepo } from '@/repositories'
import type { Task } from '@/types/entities'
import { taskInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import {
  EmptyTaskTitleError,
  addSubtask,
  addTaskTag,
  completeTask,
  createTask,
  deleteSubtask,
  deleteTask,
  moveSubtask,
  moveTask,
  removeTaskTag,
  rescheduleTask,
  restoreTask,
  setSubtaskDone,
  setTaskPriority,
  subtaskProgress,
  toggleSubtask,
  toggleTask,
  uncompleteTask,
  updateTask,
} from './taskService'

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

/** Every event type in the log, oldest first. */
async function eventTypes(): Promise<string[]> {
  const events = await eventRepo.list()
  return events.sort((a, b) => a.at - b.at || 0).map((event) => event.type)
}

describe('create', () => {
  it('stores every structured field', async () => {
    const task = await createTask({
      title: 'Study Binary Trees',
      description: 'Traversals first',
      priority: 'high',
      dueDate: '2026-09-04',
      dueTime: '19:00',
      estimateMin: 45,
    })

    expect(task).toMatchObject({
      title: 'Study Binary Trees',
      description: 'Traversals first',
      status: 'todo',
      priority: 'high',
      dueDate: '2026-09-04',
      dueTime: '19:00',
      estimateMin: 45,
      completedAt: null,
      deletedAt: null,
      isTemplate: false,
    })
  })

  it('applies sensible defaults for everything left out', async () => {
    const task = await createTask({ title: 'Book dentist' })
    expect(task).toMatchObject({
      description: null,
      priority: 'none',
      dueDate: null,
      dueTime: null,
      estimateMin: null,
      projectId: null,
      tagIds: [],
      recurrence: null,
    })
  })

  it('normalises the title rather than storing ragged whitespace', async () => {
    const task = await createTask({ title: '  Study   Java  ' })
    expect(task.title).toBe('Study Java')
  })

  it('refuses a blank title', async () => {
    await expect(createTask({ title: '   ' })).rejects.toBeInstanceOf(EmptyTaskTitleError)
    expect(await taskRepo.count()).toBe(0)
  })

  it('appends after the last task so manual order is stable', async () => {
    const first = await createTask({ title: 'First' })
    const second = await createTask({ title: 'Second' })
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
  })

  it('creates the subtasks it was given', async () => {
    const task = await createTask({
      title: 'Ship the parser',
      subtasks: ['Tokenise', 'Grammar', '   '],
    })
    const subtasks = await subtaskRepo.byTask(task.id)

    expect(subtasks.map((s) => s.title)).toEqual(['Tokenise', 'Grammar'])
    expect(subtasks[0]?.sortOrder).toBeLessThan(subtasks[1]?.sortOrder ?? 0)
  })

  it('emits exactly one task.created', async () => {
    await createTask({ title: 'Study' })
    expect(await eventTypes()).toEqual(['task.created'])
  })
})

describe('update', () => {
  it('emits task.updated for an ordinary edit', async () => {
    const task = await createTask({ title: 'Study' })
    await updateTask(task.id, { title: 'Study Java', priority: 'high' })

    expect(await eventTypes()).toEqual(['task.created', 'task.updated'])
  })

  it('emits task.rescheduled when only the schedule moved', async () => {
    const task = await createTask({ title: 'Study', dueDate: '2026-09-04' })
    await rescheduleTask(task.id, '2026-09-06', '18:30')

    expect(await eventTypes()).toEqual(['task.created', 'task.rescheduled'])
  })

  it('records both ends of a reschedule in the payload', async () => {
    const task = await createTask({ title: 'Study', dueDate: '2026-09-04', dueTime: '19:00' })
    await rescheduleTask(task.id, '2026-09-06', '18:30')

    const [event] = await eventRepo.list({ type: 'task.rescheduled' })
    expect(event?.payload).toEqual({
      from: { dueDate: '2026-09-04', dueTime: '19:00' },
      to: { dueDate: '2026-09-06', dueTime: '18:30' },
    })
  })

  it('clears the time when the date is cleared', async () => {
    const task = await createTask({ title: 'Study', dueDate: '2026-09-04', dueTime: '19:00' })
    const cleared = await rescheduleTask(task.id, null, '19:00')
    expect(cleared).toMatchObject({ dueDate: null, dueTime: null })
  })

  it('treats a schedule change bundled with an edit as an ordinary update', async () => {
    const task = await createTask({ title: 'Study' })
    await updateTask(task.id, { title: 'Study Java', dueDate: '2026-09-09' })
    expect(await eventTypes()).toEqual(['task.created', 'task.updated'])
  })

  it('writes nothing at all when the patch changes nothing', async () => {
    const task = await createTask({ title: 'Study', priority: 'high' })
    const same = await updateTask(task.id, { title: 'Study', priority: 'high' })

    expect(same.updatedAt).toBe(task.updatedAt)
    expect(await eventTypes()).toEqual(['task.created'])
  })

  it('compares tag arrays by content, not by identity', async () => {
    const task = await createTask({ title: 'Study', tagIds: ['a', 'b'] })
    await updateTask(task.id, { tagIds: ['a', 'b'] })
    expect(await eventTypes()).toEqual(['task.created'])
  })

  it('refuses to blank a title through an update', async () => {
    const task = await createTask({ title: 'Study' })
    await expect(updateTask(task.id, { title: '  ' })).rejects.toBeInstanceOf(EmptyTaskTitleError)
    expect((await taskRepo.get(task.id))?.title).toBe('Study')
  })
})

describe('completion', () => {
  it('sets the status and the completion instant', async () => {
    const task = await createTask({ title: 'Study' })
    const done = await completeTask(task.id)

    expect(done.status).toBe('done')
    expect(done.completedAt).toBeGreaterThanOrEqual(NOW.getTime())
  })

  it('emits task.completed and nothing else', async () => {
    // The whole point: completing must not also fabricate a task.updated.
    const task = await createTask({ title: 'Study' })
    await completeTask(task.id)

    expect(await eventTypes()).toEqual(['task.created', 'task.completed'])
  })

  it('carries the fields analytics will need on the completion event', async () => {
    const task = await createTask({
      title: 'Study',
      priority: 'high',
      dueDate: '2026-09-03',
      estimateMin: 45,
    })
    await completeTask(task.id)

    const [event] = await eventRepo.list({ type: 'task.completed' })
    expect(event?.payload).toMatchObject({
      title: 'Study',
      priority: 'high',
      dueDate: '2026-09-03',
      estimateMin: 45,
    })
    // The completion event is stamped with the task's own completion instant,
    // so the log and the row can never disagree about when it happened.
    const task2 = await taskRepo.get(task.id)
    expect(event?.at).toBe(task2?.completedAt)
  })

  it('is idempotent, so a double keypress cannot log two completions', async () => {
    const task = await createTask({ title: 'Study' })
    await completeTask(task.id)
    await completeTask(task.id)

    expect(await eventTypes()).toEqual(['task.created', 'task.completed'])
  })

  it('reopens a task and clears the completion instant', async () => {
    const task = await createTask({ title: 'Study' })
    await completeTask(task.id)
    const reopened = await uncompleteTask(task.id)

    expect(reopened).toMatchObject({ status: 'todo', completedAt: null })
    expect(await eventTypes()).toEqual(['task.created', 'task.completed', 'task.uncompleted'])
  })

  it('emits nothing when reopening a task that is already open', async () => {
    const task = await createTask({ title: 'Study' })
    await uncompleteTask(task.id)
    expect(await eventTypes()).toEqual(['task.created'])
  })

  it('toggles in both directions', async () => {
    const task = await createTask({ title: 'Study' })
    expect((await toggleTask(task.id)).status).toBe('done')
    expect((await toggleTask(task.id)).status).toBe('todo')
  })
})

describe('soft delete and restore', () => {
  it('keeps the row and stamps deletedAt', async () => {
    const task = await createTask({ title: 'Study' })
    await deleteTask(task.id)

    expect(await taskRepo.get(task.id)).toBeUndefined()
    const row = await taskRepo.get(task.id, { includeDeleted: true })
    expect(row?.title).toBe('Study')
    expect(row?.deletedAt).toBeGreaterThanOrEqual(NOW.getTime())
  })

  it('restores the task exactly as it was', async () => {
    const task = await createTask({ title: 'Study', priority: 'high', dueDate: '2026-09-04' })
    await deleteTask(task.id)
    const restored = await restoreTask(task.id)

    expect(restored).toMatchObject({
      title: 'Study',
      priority: 'high',
      dueDate: '2026-09-04',
      deletedAt: null,
    })
  })

  it('emits deleted then restored', async () => {
    const task = await createTask({ title: 'Study' })
    await deleteTask(task.id)
    await restoreTask(task.id)

    expect(await eventTypes()).toEqual(['task.created', 'task.deleted', 'task.restored'])
  })

  it('returns the task so the caller can offer an undo', async () => {
    const task = await createTask({ title: 'Study' })
    const deleted = await deleteTask(task.id)
    expect(deleted.title).toBe('Study')
  })

  it('leaves a deleted task out of every live read', async () => {
    const kept = await createTask({ title: 'Keep' })
    const gone = await createTask({ title: 'Delete' })
    await deleteTask(gone.id)

    const live = await taskRepo.listLive()
    expect(live.map((t) => t.id)).toEqual([kept.id])
  })
})

describe('priority and tags', () => {
  it('sets a priority', async () => {
    const task = await createTask({ title: 'Study' })
    expect((await setTaskPriority(task.id, 'urgent')).priority).toBe('urgent')
  })

  it('adds and removes a tag without duplicating it', async () => {
    const task = await createTask({ title: 'Study' })
    await addTaskTag(task.id, 'tag-1')
    await addTaskTag(task.id, 'tag-1')
    expect((await taskRepo.get(task.id))?.tagIds).toEqual(['tag-1'])

    await removeTaskTag(task.id, 'tag-1')
    expect((await taskRepo.get(task.id))?.tagIds).toEqual([])
  })

  it('emits nothing when adding a tag the task already has', async () => {
    const task = await createTask({ title: 'Study', tagIds: ['tag-1'] })
    await addTaskTag(task.id, 'tag-1')
    expect(await eventTypes()).toEqual(['task.created'])
  })
})

describe('manual ordering', () => {
  async function threeTasks(): Promise<[Task, Task, Task]> {
    // `emit: false` so the ordering assertions below see only the move.
    const a = await taskRepo.create(taskInput({ title: 'A', sortOrder: 1000 }), { emit: false })
    const b = await taskRepo.create(taskInput({ title: 'B', sortOrder: 2000 }), { emit: false })
    const c = await taskRepo.create(taskInput({ title: 'C', sortOrder: 3000 }), { emit: false })
    return [a, b, c]
  }

  it('writes exactly one row when an item moves', async () => {
    const [a, b, c] = await threeTasks()
    await moveTask([a.id, b.id, c.id], 0, 2)

    const after = await taskRepo.listLive()
    expect(after.map((t) => t.title)).toEqual(['B', 'C', 'A'])
    // B and C were not touched.
    expect(after.find((t) => t.title === 'B')?.sortOrder).toBe(2000)
    expect(after.find((t) => t.title === 'C')?.sortOrder).toBe(3000)
  })

  it('lands a moved item on the midpoint of its new neighbours', async () => {
    const [a, b, c] = await threeTasks()
    await moveTask([a.id, b.id, c.id], 2, 1)

    const moved = await taskRepo.get(c.id)
    expect(moved?.sortOrder).toBe(1500)
  })

  it('emits task.reordered rather than task.updated', async () => {
    const [a, b, c] = await threeTasks()
    await moveTask([a.id, b.id, c.id], 0, 2)
    expect(await eventTypes()).toEqual(['task.reordered'])
  })

  it('does nothing when the indices match', async () => {
    const [a, b, c] = await threeTasks()
    expect(await moveTask([a.id, b.id, c.id], 1, 1)).toBeUndefined()
    expect(await eventTypes()).toEqual([])
  })

  it('respaces instead of colliding when midpoints run out', async () => {
    const a = await taskRepo.create(taskInput({ title: 'A', sortOrder: 1000 }), { emit: false })
    const b = await taskRepo.create(taskInput({ title: 'B', sortOrder: 1000 }), { emit: false })
    const c = await taskRepo.create(taskInput({ title: 'C', sortOrder: 1000 }), { emit: false })

    await moveTask([a.id, b.id, c.id], 2, 1)

    const orders = (await taskRepo.listLive()).map((t) => t.sortOrder)
    expect(new Set(orders).size).toBe(3)
  })
})

describe('subtasks', () => {
  it('adds a subtask and appends it after the last', async () => {
    const task = await createTask({ title: 'Study' })
    const first = await addSubtask(task.id, 'Inorder')
    const second = await addSubtask(task.id, 'Preorder')

    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
    expect((await subtaskRepo.byTask(task.id)).map((s) => s.title)).toEqual([
      'Inorder',
      'Preorder',
    ])
  })

  it('refuses a blank subtask title', async () => {
    const task = await createTask({ title: 'Study' })
    await expect(addSubtask(task.id, '  ')).rejects.toBeInstanceOf(EmptyTaskTitleError)
  })

  it('refuses a subtask on a task that does not exist', async () => {
    await expect(addSubtask('00000000-0000-4000-8000-000000000000', 'x')).rejects.toThrow()
  })

  it('completes and reopens a subtask', async () => {
    const task = await createTask({ title: 'Study' })
    const subtask = await addSubtask(task.id, 'Inorder')

    expect((await setSubtaskDone(subtask.id, true)).done).toBe(true)
    expect((await setSubtaskDone(subtask.id, false)).done).toBe(false)
    expect((await toggleSubtask(subtask.id)).done).toBe(true)
  })

  it('never fabricates a task event when a subtask changes', async () => {
    // Task completion and subtask completion are separate facts; conflating
    // them would put subtask checkmarks into the tasks-completed chart.
    const task = await createTask({ title: 'Study' })
    const subtask = await addSubtask(task.id, 'Inorder')
    await setSubtaskDone(subtask.id, true)
    await setSubtaskDone(subtask.id, false)

    expect(await eventTypes()).toEqual([
      'task.created',
      'subtask.created',
      'subtask.completed',
      'subtask.uncompleted',
    ])
  })

  it('emits nothing when the subtask is already in that state', async () => {
    const task = await createTask({ title: 'Study' })
    const subtask = await addSubtask(task.id, 'Inorder')
    await setSubtaskDone(subtask.id, false)

    expect(await eventTypes()).toEqual(['task.created', 'subtask.created'])
  })

  it('soft-deletes a subtask and can restore it', async () => {
    const task = await createTask({ title: 'Study' })
    const subtask = await addSubtask(task.id, 'Inorder')

    await deleteSubtask(subtask.id)
    expect(await subtaskRepo.byTask(task.id)).toEqual([])

    await subtaskRepo.restore(subtask.id)
    expect((await subtaskRepo.byTask(task.id)).map((s) => s.title)).toEqual(['Inorder'])
  })

  it('reorders subtasks within their own task', async () => {
    const task = await createTask({ title: 'Study', subtasks: ['A', 'B', 'C'] })
    await moveSubtask(task.id, 0, 2)

    expect((await subtaskRepo.byTask(task.id)).map((s) => s.title)).toEqual(['B', 'C', 'A'])
  })

  it('reports progress without storing it', async () => {
    const task = await createTask({ title: 'Study', subtasks: ['A', 'B', 'C'] })
    const subtasks = await subtaskRepo.byTask(task.id)
    await setSubtaskDone(subtasks[0]!.id, true)

    expect(subtaskProgress(await subtaskRepo.byTask(task.id))).toEqual({ done: 1, total: 3 })
  })
})

describe('provenance', () => {
  it('records the producer on the event, never on the task', async () => {
    const task = await createTask({ title: 'Study Java' }, { source: 'quickadd' })
    await completeTask(task.id, { source: 'palette' })
    await deleteTask(task.id, { source: 'ui' })

    const events = (await eventRepo.list()).sort((a, b) => a.at - b.at)
    expect(events.map((e) => [e.type, e.source])).toEqual([
      ['task.created', 'quickadd'],
      ['task.completed', 'palette'],
      ['task.deleted', 'ui'],
    ])

    const stored = await taskRepo.get(task.id, { includeDeleted: true })
    expect(Object.keys(stored ?? {})).not.toContain('source')
  })

  it('defaults the source to the UI', async () => {
    await createTask({ title: 'Study' })
    const [event] = await eventRepo.list()
    expect(event?.source).toBe('ui')
  })
})
