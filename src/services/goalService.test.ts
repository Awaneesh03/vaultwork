import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { milestoneRepo, projectRepo, taskRepo } from '@/repositories'
import { projectInput, taskInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import {
  EmptyGoalTitleError,
  EmptyMilestoneTitleError,
  MilestoneGoalMismatchError,
  archiveGoal,
  assignTaskToMilestone,
  completeGoal,
  completeMilestone,
  createGoal,
  createMilestone,
  deleteGoal,
  deleteMilestone,
  getGoal,
  goalIdForTask,
  listGoalTasks,
  listGoals,
  listMilestones,
  moveGoal,
  moveMilestone,
  reopenGoal,
  reopenMilestone,
  restoreGoal,
  restoreMilestone,
  toggleMilestone,
  updateGoal,
  updateMilestone,
} from './goalService'
import { completeTask } from './taskService'

/**
 * The goal rules that involve the database.
 *
 * Two families of test here matter more than the rest, and they are the ones
 * that would be quietly wrong in a naive implementation:
 *
 *   - **no cascade** — finishing or deleting a goal must leave every task alone
 *   - **historical integrity** — editing a goal must leave every completion alone
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

/**
 * Event types in the order they were appended.
 *
 * Dexie returns rows in primary-key order, and the keys are UUIDs — so
 * `toArray()` is effectively shuffled. The clock helper advances `now()` by a
 * millisecond per call, which makes `at` the reliable ordering key.
 */
const eventTypes = async (entityId?: string) =>
  (await db.events.toArray())
    .filter((event) => entityId === undefined || event.entityId === entityId)
    .sort((a, b) => a.at - b.at)
    .map((event) => event.type)

describe('goal lifecycle', () => {
  it('creates a goal with sensible defaults', async () => {
    const goal = await createGoal('Become strong in DSA')
    expect(goal.title).toBe('Become strong in DSA')
    expect(goal.status).toBe('active')
    expect(goal.horizon).toBe('long')
    expect(goal.targetDate).toBeNull()
    expect(goal.sortOrder).toBe(1000)
  })

  it('collapses whitespace and refuses a blank title', async () => {
    const goal = await createGoal('  Learn   Rust  ')
    expect(goal.title).toBe('Learn Rust')
    await expect(createGoal('   ')).rejects.toThrow(EmptyGoalTitleError)
  })

  it('appends each new goal after the last', async () => {
    await createGoal('first')
    const second = await createGoal('second')
    expect(second.sortOrder).toBe(2000)
  })

  it('updates title, why, horizon and deadline', async () => {
    const goal = await createGoal('Learn Rust')
    const updated = await updateGoal(goal.id, {
      title: 'Master Rust',
      why: 'systems work',
      horizon: 'short',
      targetDate: '2027-01-01',
    })
    expect(updated).toMatchObject({
      title: 'Master Rust',
      why: 'systems work',
      horizon: 'short',
      targetDate: '2027-01-01',
    })
  })

  it('writes nothing when a patch changes nothing', async () => {
    const goal = await createGoal('Learn Rust')
    const before = (await eventTypes(goal.id)).length
    const same = await updateGoal(goal.id, { title: 'Learn Rust' })
    expect(same.updatedAt).toBe(goal.updatedAt)
    expect(await eventTypes(goal.id)).toHaveLength(before)
  })

  it('completes, reopens and archives through status alone', async () => {
    const goal = await createGoal('Learn Rust')

    expect((await completeGoal(goal.id)).status).toBe('achieved')
    expect((await reopenGoal(goal.id)).status).toBe('active')
    expect((await archiveGoal(goal.id)).status).toBe('dropped')

    // Archived is still a live row — it is not a disguised delete.
    expect(await getGoal(goal.id)).toBeDefined()
    expect(await listGoals()).toHaveLength(1)

    expect((await reopenGoal(goal.id)).status).toBe('active')
  })

  it('is idempotent about completing and archiving', async () => {
    const goal = await createGoal('Learn Rust')
    await completeGoal(goal.id)
    const before = await eventTypes(goal.id)
    await completeGoal(goal.id)
    expect(await eventTypes(goal.id)).toEqual(before)
  })

  it('emits one domain event per state change', async () => {
    const goal = await createGoal('Learn Rust')
    await completeGoal(goal.id)
    await reopenGoal(goal.id)
    await archiveGoal(goal.id)

    expect(await eventTypes(goal.id)).toEqual([
      'goal.created',
      'goal.completed',
      'goal.reopened',
      'goal.archived',
    ])
  })

  it('soft-deletes and restores exactly', async () => {
    const goal = await createGoal('Learn Rust', { targetDate: '2027-01-01' })
    await createMilestone(goal.id, 'Ownership')

    const deletion = await deleteGoal(goal.id)
    expect(deletion.retainedMilestoneCount).toBe(1)
    expect(await listGoals()).toHaveLength(0)

    const restored = await restoreGoal(goal.id)
    expect(restored.targetDate).toBe('2027-01-01')
    // The structure came back with it, because it was never taken apart.
    expect(await listMilestones(goal.id)).toHaveLength(1)
  })
})

describe('milestones', () => {
  it('creates checkpoints under a goal, appending in order', async () => {
    const goal = await createGoal('DSA')
    const first = await createMilestone(goal.id, 'Arrays')
    const second = await createMilestone(goal.id, 'Trees')

    expect(first.goalId).toBe(goal.id)
    expect(first.done).toBe(false)
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
    expect((await listMilestones(goal.id)).map((m) => m.title)).toEqual(['Arrays', 'Trees'])
  })

  it('refuses a blank title and a goal that does not exist', async () => {
    const goal = await createGoal('DSA')
    await expect(createMilestone(goal.id, '  ')).rejects.toThrow(EmptyMilestoneTitleError)
    await expect(createMilestone('missing-goal', 'Arrays')).rejects.toThrow()
  })

  it('cannot create a milestone under a deleted goal', async () => {
    const goal = await createGoal('DSA')
    await deleteGoal(goal.id)
    await expect(createMilestone(goal.id, 'Arrays')).rejects.toThrow()
  })

  it('edits title and target date', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const updated = await updateMilestone(milestone.id, {
      title: 'Arrays and Strings',
      targetDate: '2026-10-01',
    })
    expect(updated.title).toBe('Arrays and Strings')
    expect(updated.targetDate).toBe('2026-10-01')
    expect(updated.goalId).toBe(goal.id)
  })

  it('completes, reopens and toggles', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')

    expect((await completeMilestone(milestone.id)).done).toBe(true)
    expect((await reopenMilestone(milestone.id)).done).toBe(false)
    expect((await toggleMilestone(milestone.id)).done).toBe(true)
    expect((await toggleMilestone(milestone.id)).done).toBe(false)

    expect(await eventTypes(milestone.id)).toEqual([
      'milestone.created',
      'milestone.completed',
      'milestone.reopened',
      'milestone.completed',
      'milestone.reopened',
    ])
  })

  it('soft-deletes a milestone and restores it with its tasks attached', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const task = await taskRepo.create(taskInput({ milestoneId: milestone.id }))

    const deletion = await deleteMilestone(milestone.id)
    expect(deletion.retainedTaskCount).toBe(1)
    expect(await listMilestones(goal.id)).toHaveLength(0)

    // The task kept its pointer, which is the only reason restore can work.
    expect((await taskRepo.get(task.id))?.milestoneId).toBe(milestone.id)

    await restoreMilestone(milestone.id)
    expect(await listMilestones(goal.id)).toHaveLength(1)
    expect(await milestoneRepo.countTasks(milestone.id)).toBe(1)
  })
})

describe('no cascade into tasks', () => {
  const setup = async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const open = await taskRepo.create(taskInput({ title: 'open', milestoneId: milestone.id }))
    const other = await taskRepo.create(taskInput({ title: 'unrelated' }))
    return { goal, milestone, open, other }
  }

  it('completing a goal completes no task and no milestone', async () => {
    const { goal, milestone, open } = await setup()

    await completeGoal(goal.id)

    expect((await taskRepo.get(open.id))?.status).toBe('todo')
    expect((await taskRepo.get(open.id))?.completedAt).toBeNull()
    expect((await milestoneRepo.get(milestone.id))?.done).toBe(false)
  })

  it('completing a milestone completes no task', async () => {
    const { milestone, open } = await setup()

    await completeMilestone(milestone.id)

    expect((await taskRepo.get(open.id))?.status).toBe('todo')
    // The event records how many were still open, without changing them.
    const event = (await db.events.toArray()).find((e) => e.type === 'milestone.completed')
    expect(event?.payload).toMatchObject({ openTasks: 1 })
  })

  it('archiving a goal deletes and completes nothing', async () => {
    const { goal, milestone, open } = await setup()

    await archiveGoal(goal.id)

    expect((await taskRepo.get(open.id))?.status).toBe('todo')
    expect(await milestoneRepo.get(milestone.id)).toBeDefined()
  })

  it('deleting a goal leaves every task and milestone in place', async () => {
    const { goal, milestone, open, other } = await setup()

    const deletion = await deleteGoal(goal.id)
    expect(deletion.retainedTaskCount).toBe(1)

    expect(await taskRepo.get(open.id)).toBeDefined()
    expect((await taskRepo.get(open.id))?.status).toBe('todo')
    expect(await taskRepo.get(other.id)).toBeDefined()
    // The milestone row survives too, so restore brings back the whole shape.
    expect(await milestoneRepo.get(milestone.id)).toBeDefined()
  })

  it('deleting a milestone never deletes or unlinks its tasks', async () => {
    const { milestone, open } = await setup()

    await deleteMilestone(milestone.id)

    const task = await taskRepo.get(open.id)
    expect(task).toBeDefined()
    expect(task?.status).toBe('todo')
    expect(task?.milestoneId).toBe(milestone.id)
  })

  it('emits no task events when a goal is completed or deleted', async () => {
    const { goal } = await setup()
    const before = new Set((await db.events.toArray()).map((event) => event.id))

    await completeGoal(goal.id)
    await deleteGoal(goal.id)

    const added = (await db.events.toArray()).filter((event) => !before.has(event.id))
    expect(added.length).toBeGreaterThan(0)
    expect(added.some((event) => event.entityType === 'task')).toBe(false)
  })
})

describe('historical integrity', () => {
  it('renaming a goal does not rewrite milestone completion', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const completed = await completeMilestone(milestone.id)

    await updateGoal(goal.id, { title: 'Data Structures' })

    const after = await milestoneRepo.get(milestone.id)
    expect(after?.done).toBe(true)
    // Not merely still true — the row itself was never written.
    expect(after?.updatedAt).toBe(completed.updatedAt)
  })

  it('moving a goal deadline does not touch its milestones or their dates', async () => {
    const goal = await createGoal('DSA', { targetDate: '2027-01-01' })
    const milestone = await createMilestone(goal.id, 'Arrays', { targetDate: '2026-10-01' })

    await updateGoal(goal.id, { targetDate: '2026-09-10' })

    const after = await milestoneRepo.get(milestone.id)
    expect(after?.targetDate).toBe('2026-10-01')
    expect(after?.updatedAt).toBe(milestone.updatedAt)
  })

  it('archiving and restoring a goal preserves what was completed', async () => {
    const goal = await createGoal('DSA')
    const done = await createMilestone(goal.id, 'Arrays')
    const open = await createMilestone(goal.id, 'Trees')
    await completeMilestone(done.id)

    const task = await taskRepo.create(taskInput({ milestoneId: done.id }))
    await completeTask(task.id)
    const completedTask = await taskRepo.get(task.id)

    await archiveGoal(goal.id)
    await reopenGoal(goal.id)
    await deleteGoal(goal.id)
    await restoreGoal(goal.id)

    expect((await milestoneRepo.get(done.id))?.done).toBe(true)
    expect((await milestoneRepo.get(open.id))?.done).toBe(false)
    // The task's completion timestamp is the record of when it happened, and
    // nothing about the goal's own state may alter it.
    expect((await taskRepo.get(task.id))?.completedAt).toBe(completedTask?.completedAt)
  })

  it('renaming a milestone does not un-complete it', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    await completeMilestone(milestone.id)

    const renamed = await updateMilestone(milestone.id, { title: 'Arrays and Strings' })
    expect(renamed.done).toBe(true)
  })
})

describe('task assignment', () => {
  it('assigns and clears a milestone through TaskService', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const task = await taskRepo.create(taskInput())

    const assigned = await assignTaskToMilestone(task.id, milestone.id)
    expect(assigned.milestoneId).toBe(milestone.id)
    // The write went through TaskService, so it emitted a task event.
    expect(await eventTypes(task.id)).toContain('task.updated')

    const cleared = await assignTaskToMilestone(task.id, null)
    expect(cleared.milestoneId).toBeNull()
  })

  it('refuses a milestone that does not exist or is deleted', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const task = await taskRepo.create(taskInput())

    await expect(assignTaskToMilestone(task.id, 'nope')).rejects.toThrow()

    await deleteMilestone(milestone.id)
    await expect(assignTaskToMilestone(task.id, milestone.id)).rejects.toThrow()
  })

  it('refuses a milestone under a deleted goal', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const task = await taskRepo.create(taskInput())

    await deleteGoal(goal.id)
    await expect(assignTaskToMilestone(task.id, milestone.id)).rejects.toThrow()
  })

  it('rejects a caller whose milestone and goal disagree', async () => {
    const mine = await createGoal('DSA')
    const theirs = await createGoal('Rust')
    const milestone = await createMilestone(theirs.id, 'Ownership')
    const task = await taskRepo.create(taskInput())

    await expect(
      assignTaskToMilestone(task.id, milestone.id, { expectedGoalId: mine.id }),
    ).rejects.toThrow(MilestoneGoalMismatchError)

    // Nothing was written on the way to the error.
    expect((await taskRepo.get(task.id))?.milestoneId).toBeNull()
  })

  it('resolves the goal of a task through its milestone', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const linked = await taskRepo.create(taskInput({ milestoneId: milestone.id }))
    const loose = await taskRepo.create(taskInput())

    expect(await goalIdForTask(linked)).toBe(goal.id)
    expect(await goalIdForTask(loose)).toBeNull()
  })
})

describe('related tasks', () => {
  it('collects tasks through milestones and through linked projects, once each', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const project = await projectRepo.create(projectInput({ goalId: goal.id }))
    const unrelated = await projectRepo.create(projectInput({ name: 'Other' }))

    const viaMilestone = await taskRepo.create(
      taskInput({ title: 'via milestone', milestoneId: milestone.id }),
    )
    const viaProject = await taskRepo.create(
      taskInput({ title: 'via project', projectId: project.id }),
    )
    // Reachable both ways — it must still be counted once.
    const viaBoth = await taskRepo.create(
      taskInput({ title: 'both', milestoneId: milestone.id, projectId: project.id }),
    )
    await taskRepo.create(taskInput({ title: 'unrelated', projectId: unrelated.id }))

    const tasks = await listGoalTasks(goal.id)
    expect(tasks.map((task) => task.id).sort()).toEqual(
      [viaMilestone.id, viaProject.id, viaBoth.id].sort(),
    )
  })

  it('is empty for a goal with nothing attached', async () => {
    const goal = await createGoal('DSA')
    await taskRepo.create(taskInput())
    expect(await listGoalTasks(goal.id)).toEqual([])
  })

  it('excludes deleted tasks and recurrence templates', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const kept = await taskRepo.create(taskInput({ milestoneId: milestone.id }))
    const gone = await taskRepo.create(taskInput({ milestoneId: milestone.id }))
    await taskRepo.create(taskInput({ milestoneId: milestone.id, isTemplate: true }))
    await taskRepo.softDelete(gone.id)

    expect((await listGoalTasks(goal.id)).map((task) => task.id)).toEqual([kept.id])
  })
})

describe('ordering', () => {
  it('moves a goal by writing one row', async () => {
    const a = await createGoal('a')
    const b = await createGoal('b')
    const c = await createGoal('c')

    await moveGoal([a.id, b.id, c.id], 2, 0)

    expect((await listGoals()).map((goal) => goal.title)).toEqual(['c', 'a', 'b'])
    // Only the moved goal was rewritten.
    expect((await getGoal(a.id))?.sortOrder).toBe(a.sortOrder)
    expect((await getGoal(b.id))?.sortOrder).toBe(b.sortOrder)
  })

  it('moves a milestone without touching task sortOrder', async () => {
    const goal = await createGoal('DSA')
    const first = await createMilestone(goal.id, 'Arrays')
    const second = await createMilestone(goal.id, 'Trees')
    const task = await taskRepo.create(taskInput({ milestoneId: first.id, sortOrder: 4242 }))

    await moveMilestone(goal.id, [first.id, second.id], 1, 0)

    expect((await listMilestones(goal.id)).map((m) => m.title)).toEqual(['Trees', 'Arrays'])
    // Milestones and tasks are two separate ordered lists.
    expect((await taskRepo.get(task.id))?.sortOrder).toBe(4242)
  })

  it('never reorders milestones across goals', async () => {
    const mine = await createGoal('mine')
    const theirs = await createGoal('theirs')
    const a = await createMilestone(mine.id, 'A')
    const b = await createMilestone(theirs.id, 'B')

    // `b` is not a milestone of `mine`, so the move is refused outright.
    expect(await moveMilestone(mine.id, [a.id, b.id], 1, 0)).toBeUndefined()
    expect((await milestoneRepo.get(b.id))?.sortOrder).toBe(b.sortOrder)
  })

  it('does nothing when an item is dropped where it already was', async () => {
    const a = await createGoal('a')
    const b = await createGoal('b')
    expect(await moveGoal([a.id, b.id], 0, 0)).toBeUndefined()
  })

  it('respaces rather than colliding when precision runs out', async () => {
    const a = await createGoal('a', { sortOrder: 1000 })
    const b = await createGoal('b', { sortOrder: 1000.0000001 })
    const c = await createGoal('c', { sortOrder: 1000.0000002 })

    await moveGoal([a.id, b.id, c.id], 2, 1)

    const titles = (await listGoals()).map((goal) => goal.title)
    expect(titles).toEqual(['a', 'c', 'b'])
    const orders = (await listGoals()).map((goal) => goal.sortOrder)
    expect(new Set(orders).size).toBe(3)
  })

  it('emits a reorder event, not a generic update', async () => {
    const a = await createGoal('a')
    const b = await createGoal('b')
    await moveGoal([a.id, b.id], 1, 0)
    expect(await eventTypes(b.id)).toEqual(['goal.created', 'goal.reordered'])
  })
})
