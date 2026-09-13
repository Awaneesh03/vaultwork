import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { milestoneRepo, taskRepo } from '@/repositories'
import {
  byId,
  createGoal,
  createMilestone,
  execute,
  executeText,
  listGoals,
  listMilestones,
  parseCommand,
  resolveChoice,
  type CommandIntent,
} from '@/services'
import { taskInput } from './factories'
import { freezeClock, resetDatabase } from './helpers'

/**
 * Goals through the whole command pipeline: text → intent → execute → Dexie.
 *
 * The two things worth proving end to end are that a goal command reverses
 * exactly, and that **quick add never invents a goal** — bare text is always a
 * task, whatever it says.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const ctx = { source: 'palette' as const, now: NOW }

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

describe('parsing', () => {
  it('routes /goals and a bare /goal to the Goals screen', () => {
    expect(parseCommand('/goals', ctx)).toMatchObject({
      kind: 'app.navigate',
      path: '/goals',
    })
    expect(parseCommand('/goal', ctx)).toMatchObject({
      kind: 'app.navigate',
      path: '/goals',
    })
  })

  it('routes /goal <name> to opening one goal', () => {
    expect(parseCommand('/goal dsa', ctx)).toMatchObject({
      kind: 'goal.open',
      ref: { by: 'text', query: 'dsa' },
    })
  })

  it('creates a goal only from the explicit /add goal form', () => {
    expect(parseCommand('/add goal Become strong in DSA', ctx)).toMatchObject({
      kind: 'goal.add',
      title: 'Become strong in DSA',
    })
  })

  it('never infers a goal from ordinary quick-add text', () => {
    // Every one of these reads like a goal. All of them are tasks, because
    // guessing would create a long-lived record nobody asked for.
    for (const text of [
      'Become strong in DSA',
      'goal: get fit',
      'my goal is to read more',
      'Achieve financial independence',
    ]) {
      expect(parseCommand(text, ctx).kind).toBe('task.add')
    }
  })

  it('does not treat /add goals or /goalpost as goal syntax', () => {
    // The qualifier is the whole word "goal" followed by text.
    expect(parseCommand('/add goalkeeper gloves', ctx).kind).toBe('task.add')
    expect(parseCommand('/goalpost', ctx)).toMatchObject({ kind: 'unknown' })
  })
})

describe('goal commands', () => {
  it('adds a goal and undoes it exactly', async () => {
    const added = await executeText('/add goal Become strong in DSA', ctx)
    expect(added.status).toBe('ok')
    expect(await listGoals()).toHaveLength(1)

    if (added.status !== 'ok' || added.kind !== 'goal') throw new Error('expected a goal')
    expect(added.undo).not.toBeNull()

    await execute(added.undo as CommandIntent)
    expect(await listGoals()).toHaveLength(0)
  })

  it('completes a goal by name and says the tasks were untouched', async () => {
    const goal = await createGoal('Become strong in DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const task = await taskRepo.create(taskInput({ milestoneId: milestone.id }))

    const result = await execute({
      kind: 'goal.complete',
      source: 'palette',
      raw: '',
      ref: byId(goal.id),
    })

    expect(result.status).toBe('ok')
    expect(result.message).toContain('tasks untouched')
    expect((await taskRepo.get(task.id))?.status).toBe('todo')
    expect((await milestoneRepo.get(milestone.id))?.done).toBe(false)
  })

  it('reverses archive, delete and complete', async () => {
    const goal = await createGoal('DSA')
    const run = (intent: CommandIntent) => execute(intent)

    const archived = await run({
      kind: 'goal.archive',
      source: 'palette',
      raw: '',
      ref: byId(goal.id),
    })
    if (archived.status !== 'ok' || archived.kind !== 'goal') throw new Error('expected a goal')
    expect(archived.goal.status).toBe('dropped')
    await run(archived.undo as CommandIntent)
    expect((await listGoals())[0]?.status).toBe('active')

    const deleted = await run({
      kind: 'goal.delete',
      source: 'palette',
      raw: '',
      ref: byId(goal.id),
    })
    if (deleted.status !== 'ok' || deleted.kind !== 'goal') throw new Error('expected a goal')
    expect(await listGoals()).toHaveLength(0)
    await run(deleted.undo as CommandIntent)
    expect(await listGoals()).toHaveLength(1)
  })

  it('says how much a delete kept', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    await taskRepo.create(taskInput({ milestoneId: milestone.id }))

    const result = await execute({
      kind: 'goal.delete',
      source: 'palette',
      raw: '',
      ref: byId(goal.id),
    })
    expect(result.message).toContain('1 milestone and 1 task kept')
  })

  it('refuses to guess between two goals with similar names', async () => {
    await createGoal('Learn Rust')
    await createGoal('Learn Racket')

    const result = await executeText('/goal learn r', ctx)
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') throw new Error('expected ambiguity')
    expect(result.choices).toHaveLength(2)

    // Picking one re-runs the intent by id, so the resolver is not consulted
    // again and the choice cannot drift.
    const picked = await resolveChoice(result.intent, result.choices[1]!.id)
    expect(picked.status).toBe('ok')
    expect(picked.message).toBe('Learn Racket')
  })

  it('reports a goal that does not exist without creating one', async () => {
    const result = await executeText('/goal nothing like this', ctx)
    expect(result.status).toBe('not_found')
    expect(await listGoals()).toHaveLength(0)
  })

  it('is idempotent about completing and archiving', async () => {
    const goal = await createGoal('DSA')
    await execute({ kind: 'goal.complete', source: 'ui', raw: '', ref: byId(goal.id) })
    const again = await execute({
      kind: 'goal.complete',
      source: 'ui',
      raw: '',
      ref: byId(goal.id),
    })
    expect(again.status).toBe('ok')
    expect(again.message).toContain('already complete')
  })
})

describe('milestone commands', () => {
  it('adds, toggles and reverses a milestone', async () => {
    const goal = await createGoal('DSA')

    const added = await execute({
      kind: 'milestone.add',
      source: 'ui',
      raw: '',
      goalId: goal.id,
      title: 'Arrays',
      targetDate: null,
    })
    if (added.status !== 'ok' || added.kind !== 'milestone') throw new Error('expected one')
    expect(await listMilestones(goal.id)).toHaveLength(1)

    const toggled = await execute({
      kind: 'milestone.toggle',
      source: 'ui',
      raw: '',
      milestoneId: added.milestone.id,
    })
    if (toggled.status !== 'ok' || toggled.kind !== 'milestone') throw new Error('expected one')
    expect(toggled.milestone.done).toBe(true)

    // Its own undo is another toggle, so ⌘Z puts the checkbox back.
    await execute(toggled.undo as CommandIntent)
    expect((await milestoneRepo.get(added.milestone.id))?.done).toBe(false)

    await execute(added.undo as CommandIntent)
    expect(await listMilestones(goal.id)).toHaveLength(0)
  })

  it('says a milestone delete affected no tasks when it did not', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')

    const result = await execute({
      kind: 'milestone.delete',
      source: 'ui',
      raw: '',
      milestoneId: milestone.id,
    })
    expect(result.message).toContain('no tasks affected')
  })

  it('assigns a task to a milestone through TaskService', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const task = await taskRepo.create(taskInput())

    const result = await execute({
      kind: 'task.assignMilestone',
      source: 'ui',
      raw: '',
      taskId: task.id,
      milestoneId: milestone.id,
    })

    expect(result.status).toBe('ok')
    expect((await taskRepo.get(task.id))?.milestoneId).toBe(milestone.id)

    // The write emitted a task event, because TaskService performed it.
    const events = (await db.events.toArray()).filter((event) => event.entityId === task.id)
    expect(events.map((event) => event.type)).toContain('task.updated')
  })

  it('surfaces a failure rather than half-writing', async () => {
    const task = await taskRepo.create(taskInput())
    const result = await execute({
      kind: 'task.assignMilestone',
      source: 'ui',
      raw: '',
      taskId: task.id,
      milestoneId: 'does-not-exist',
    })
    expect(result.status).toBe('error')
    expect((await taskRepo.get(task.id))?.milestoneId).toBeNull()
  })
})

describe('event log', () => {
  it('records one domain event per command, with the source that asked', async () => {
    const before = new Set((await db.events.toArray()).map((event) => event.id))

    await executeText('/add goal DSA', ctx)

    const added = (await db.events.toArray()).filter((event) => !before.has(event.id))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ type: 'goal.created', source: 'palette' })
  })

  it('writes no task events when a goal command runs', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    await taskRepo.create(taskInput({ milestoneId: milestone.id }))

    const before = new Set((await db.events.toArray()).map((event) => event.id))
    await execute({ kind: 'goal.complete', source: 'ui', raw: '', ref: byId(goal.id) })
    await execute({ kind: 'goal.archive', source: 'ui', raw: '', ref: byId(goal.id) })

    const added = (await db.events.toArray()).filter((event) => !before.has(event.id))
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((event) => event.entityType === 'goal')).toBe(true)
  })
})
