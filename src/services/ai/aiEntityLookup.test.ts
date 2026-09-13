import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAiPlan } from '@/ai/bridge/aiIntentBridge'
import type { AiStep, ProposedIntent } from '@/ai/aiTypes'
import { completeTask, createTask, deleteTask } from '../taskService'
import { resetDatabase, freezeClock } from '../../../tests/helpers'
import { createAiEntityLookup } from './aiEntityLookup'

/**
 * Turning a phrase into a row, against the real database.
 *
 * The bridge's own tests use a fake lookup, which proves the mapping. This
 * proves the half a fake cannot: that the phrase is answered by the
 * application's existing resolver, over the same pools the executor uses, on
 * data as it is *now* rather than as some snapshot remembered it.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)
const RAW = 'Complete my Java task'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const complete = (query: string): ProposedIntent => ({
  kind: 'task.complete',
  source: 'ai',
  raw: RAW,
  ref: { by: 'text', query },
})

const reschedule = (query: string): ProposedIntent => ({
  kind: 'task.reschedule',
  source: 'ai',
  raw: RAW,
  ref: { by: 'text', query },
  dueDate: '2026-09-07',
  dueTime: '19:00',
})

const step = (intent: ProposedIntent, id = 'step-1'): AiStep => ({
  id,
  description: 'do it',
  intent,
})

const resolve = (steps: AiStep[]) => resolveAiPlan(steps, createAiEntityLookup())

describe('resolving against real data', () => {
  it('finds the one task a phrase names', async () => {
    const task = await createTask({ title: 'Study Java' })
    await createTask({ title: 'Write essay' })

    const result = await resolve([step(complete('Study Java'))])

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.intents[0]).toEqual({
      kind: 'task.complete',
      source: 'ai',
      raw: RAW,
      ref: { by: 'id', id: task.id },
    })
  })

  it('uses the existing resolver’s tiers rather than a match of its own', async () => {
    // An exact title outranks a substring match, which is `entityResolver`'s
    // rule. If this ever changes, it changes for the palette too — which is the
    // point of not writing a second matcher.
    const exact = await createTask({ title: 'Java' })
    await createTask({ title: 'Java Assignment' })

    const result = await resolve([step(complete('Java'))])

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    const intent = result.intents[0]
    if (intent?.kind !== 'task.complete') throw new Error('expected task.complete')
    expect(intent.ref).toEqual({ by: 'id', id: exact.id })
  })

  it('stays ambiguous when several tasks tie, and offers the real rows', async () => {
    /*
     * "Java" against these three does *not* produce three choices, and the
     * reason is worth pinning: `entityResolver` commits only within its best
     * matching tier. "Java Assignment" and "Java DSA Practice" match at the
     * prefix tier; "Study Java" only at the all-words tier below it. So the
     * ambiguity is between the two prefix matches, and the weaker match is not
     * offered at all.
     *
     * That is the resolver's judgement, not this layer's — which is the whole
     * argument for reusing it rather than writing a second matcher that would
     * have answered differently from the command palette.
     */
    await createTask({ title: 'Study Java' })
    await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })

    const result = await resolve([step(complete('Java'))])

    expect(result.status).toBe('needs_clarification')
    const outcome = result.steps[0]
    if (outcome?.status !== 'ambiguous') throw new Error('expected ambiguity')

    expect(outcome.choices.map((choice) => choice.label).sort()).toEqual([
      'Java Assignment',
      'Java DSA Practice',
    ])
    expect(outcome.choices.map((choice) => choice.index)).toEqual([1, 2])
  })

  it('commits to an exact title even when weaker matches exist', async () => {
    // The other half of the tier rule: an exact match is unambiguous however
    // many partial matches sit beneath it.
    const exact = await createTask({ title: 'Study Java' })
    await createTask({ title: 'Study Java again' })
    await createTask({ title: 'Study Java thoroughly' })

    const result = await resolve([step(complete('Study Java'))])

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    const intent = result.intents[0]
    if (intent?.kind !== 'task.complete') throw new Error('expected task.complete')
    expect(intent.ref).toEqual({ by: 'id', id: exact.id })
  })

  it('reports not_found for a phrase that names nothing', async () => {
    await createTask({ title: 'Study Java' })

    const result = await resolve([step(complete('quantum physics'))])

    expect(result.status).toBe('invalid')
    expect(result.steps[0]?.status).toBe('not_found')
  })
})

describe('the pools match the executor', () => {
  it('will not complete a task that is already done', async () => {
    // `task.complete` resolves among open tasks, as the executor does. A
    // finished task is not a candidate.
    const task = await createTask({ title: 'Study Java' })
    await completeTask(task.id)

    const result = await resolve([step(complete('Study Java'))])

    expect(result.status).toBe('invalid')
    expect(result.steps[0]?.status).toBe('not_found')
  })

  it('will still reschedule a task that is done', async () => {
    // `task.reschedule` resolves over every live task, as the executor does.
    const task = await createTask({ title: 'Study Java' })
    await completeTask(task.id)

    const result = await resolve([step(reschedule('Study Java'))])

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    const intent = result.intents[0]
    if (intent?.kind !== 'task.reschedule') throw new Error('expected task.reschedule')
    expect(intent.ref).toEqual({ by: 'id', id: task.id })
  })
})

describe('current state wins over stale context', () => {
  it('does not resurrect a task deleted after the model was told about it', async () => {
    // The M15.3 snapshot showed "Study Java"; by the time the reply came back
    // the task was gone. No id is manufactured from the snapshot.
    const task = await createTask({ title: 'Study Java' })
    await deleteTask(task.id)

    const result = await resolve([step(complete('Study Java'))])

    expect(result.status).toBe('invalid')
    expect(result.steps[0]?.status).toBe('not_found')
    expect(JSON.stringify(result)).not.toContain(task.id)
  })

  it('becomes ambiguous when a second task with the same name appeared', async () => {
    // Two rows tie at the exact tier, so the phrase that used to name one row
    // now names two. Current state decides, and it refuses to guess.
    await createTask({ title: 'Study Java' })
    await createTask({ title: 'Study Java' })

    expect((await resolve([step(complete('Study Java'))])).status).toBe('needs_clarification')
  })
})

describe('the read', () => {
  it('reads once for a whole multi-step plan', async () => {
    // Four steps must not cost four scans — and more importantly, every step of
    // one pass must see the same database.
    await createTask({ title: 'Alpha' })
    await createTask({ title: 'Beta' })
    await createTask({ title: 'Gamma' })

    const queryService = await import('../taskQueryService')
    const spy = vi.spyOn(queryService, 'getTaskView')

    // A lookup built from the spied module, so the memoisation is observable.
    const lookup = createAiEntityLookup()
    await resolveAiPlan(
      [
        step(complete('Alpha'), 'step-1'),
        step(complete('Beta'), 'step-2'),
        step(reschedule('Gamma'), 'step-3'),
      ],
      lookup,
    )

    expect(spy.mock.calls.length).toBeLessThanOrEqual(1)
    vi.restoreAllMocks()
  })

  it('is not a cache: a new pass sees new data', async () => {
    await createTask({ title: 'Study Java' })
    expect((await resolve([step(complete('Study Java'))])).status).toBe('resolved')

    await createTask({ title: 'Study Java' })
    expect((await resolve([step(complete('Study Java'))])).status).toBe('needs_clarification')
  })
})

describe('resolution changes nothing', () => {
  it('writes no event', async () => {
    const { eventRepo } = await import('@/repositories')
    await createTask({ title: 'Study Java' })

    const before = (await eventRepo.list()).length
    await resolve([step(complete('Study Java'))])
    await resolve([step(reschedule('Study Java'))])

    expect((await eventRepo.list()).length).toBe(before)
  })

  it('leaves the task exactly as it was', async () => {
    const task = await createTask({ title: 'Study Java', dueDate: '2026-09-10' })

    await resolve([step(complete('Study Java'))])
    await resolve([step(reschedule('Study Java'))])

    const { taskRepo } = await import('@/repositories')
    const after = await taskRepo.get(task.id)

    expect(after?.status).toBe('todo')
    expect(after?.dueDate).toBe('2026-09-10')
    expect(after?.updatedAt).toBe(task.updatedAt)
  })

  it('never calls the command executor, even against real data', async () => {
    const executor = await import('../commands/commandExecutor')
    const execute = vi.spyOn(executor, 'execute')

    await createTask({ title: 'Study Java' })
    await resolve([step(complete('Study Java'))])

    expect(execute).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
