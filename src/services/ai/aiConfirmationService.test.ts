import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAiPlan } from '@/ai/bridge/aiIntentBridge'
import type { AiResolution } from '@/ai/bridge/aiBridgeTypes'
import type { AiStep, ProposedIntent } from '@/ai/aiTypes'
import { platform } from '@/platform'
import { eventRepo, taskRepo } from '@/repositories'
import { createTask, deleteTask } from '../taskService'
import * as executor from '../commands/commandExecutor'
import { resetDatabase, freezeClock } from '../../../tests/helpers'
import { createAiEntityLookup } from './aiEntityLookup'
import {
  AI_CONFIRMATION_TTL_MS,
  cancelAiConfirmation,
  confirmAiAction,
  createAiConfirmation,
  getAiConfirmation,
  resetAiConfirmations,
} from './aiConfirmationService'

/**
 * The gate between a proposal and a mutation.
 *
 * The claim under test is a negative one, and it is the whole milestone:
 * **nothing a model proposed changes the database until a person confirms that
 * exact action.** So most of these tests assert that something did *not*
 * happen — the row is unchanged, the event log did not grow, the executor was
 * never called — and then that it did, once, after an explicit confirmation.
 *
 * Everything runs against the real database, the real executor and the real
 * event system, because a fake executor could not prove that confirmation
 * reaches the same path a mouse click does.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)
const RAW = 'Complete my Java task'

beforeEach(async () => {
  await resetDatabase()
  resetAiConfirmations()
  freezeClock(NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
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

const add = (title: string): ProposedIntent => ({
  kind: 'task.add',
  source: 'ai',
  raw: RAW,
  title,
  dueDate: '2026-09-07',
  dueTime: null,
  priority: 'high',
  projectName: null,
  estimateMin: 45,
})

const step = (intent: ProposedIntent, id = 'step-1', description = 'do it'): AiStep => ({
  id,
  description,
  intent,
})

/** The full M15.2 → M15.4 → M15.5 path, minus the provider. */
const propose = async (steps: AiStep[]) => {
  const resolution = await resolveAiPlan(steps, createAiEntityLookup())
  return createAiConfirmation(resolution)
}

const eventCount = async () => (await eventRepo.list()).length

describe('creating a proposal', () => {
  it('changes nothing at all', async () => {
    const task = await createTask({ title: 'Study Java', dueDate: '2026-09-10' })
    const before = await eventCount()

    const confirmation = await propose([step(complete('Study Java'))])

    expect(confirmation).not.toBeNull()
    const after = await taskRepo.get(task.id)
    expect(after?.status).toBe('todo')
    expect(after?.dueDate).toBe('2026-09-10')
    expect(after?.updatedAt).toBe(task.updatedAt)
    expect(await eventCount()).toBe(before)
  })

  it('never calls the executor', async () => {
    const spy = vi.spyOn(executor, 'execute')
    await createTask({ title: 'Study Java' })

    await propose([step(complete('Study Java'))])

    expect(spy).not.toHaveBeenCalled()
  })

  it('pins the resolved id, not the phrase the model used', async () => {
    const task = await createTask({ title: 'Study Java' })

    const confirmation = await propose([step(complete('Study Java'))])

    expect(confirmation?.intents[0]).toEqual({
      kind: 'task.complete',
      source: 'ai',
      raw: RAW,
      ref: { by: 'id', id: task.id },
    })
  })

  it('writes its own summary, and keeps the model’s words as context only', async () => {
    await createTask({ title: 'Study Java' })

    const confirmation = await propose([
      step(complete('Study Java'), 'step-1', 'Tidy up a few old things'),
    ])

    // The model said one thing; the summary says what will happen.
    expect(confirmation?.summary).toEqual(['Complete task: “Study Java”'])
    expect(confirmation?.aiDescriptions).toEqual(['Tidy up a few old things'])
  })

  it('refuses a plan that never fully resolved', async () => {
    await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })

    // Ambiguous: there is no pinned id, so there is nothing to authorise.
    const ambiguous = await resolveAiPlan([step(complete('Java'))], createAiEntityLookup())
    expect(ambiguous.status).toBe('needs_clarification')
    expect(await createAiConfirmation(ambiguous)).toBeNull()

    const missing = await resolveAiPlan([step(complete('quantum physics'))], createAiEntityLookup())
    expect(await createAiConfirmation(missing)).toBeNull()
  })

  it('refuses a plan whose attribution is not ai', async () => {
    const task = await createTask({ title: 'Study Java' })
    const spoofed: AiResolution = {
      status: 'resolved',
      steps: [],
      intents: [
        {
          kind: 'task.complete',
          source: 'telegram',
          raw: RAW,
          ref: { by: 'id', id: task.id },
        },
      ],
    }

    expect(await createAiConfirmation(spoofed)).toBeNull()
  })
})

describe('confirming', () => {
  it('completes the task through the existing executor', async () => {
    const task = await createTask({ title: 'Study Java' })
    const spy = vi.spyOn(executor, 'execute')
    const confirmation = await propose([step(complete('Study Java'))])

    // Still untouched right up to the moment of confirmation.
    expect((await taskRepo.get(task.id))?.status).toBe('todo')

    const outcome = await confirmAiAction(confirmation?.id ?? '')

    expect(outcome.status).toBe('executed')
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await taskRepo.get(task.id))?.status).toBe('done')
  })

  it('reschedules through the existing executor', async () => {
    const task = await createTask({ title: 'Study Java', dueDate: '2026-09-20' })
    const confirmation = await propose([step(reschedule('Study Java'))])

    expect((await taskRepo.get(task.id))?.dueDate).toBe('2026-09-20')

    const outcome = await confirmAiAction(confirmation?.id ?? '')

    expect(outcome.status).toBe('executed')
    const after = await taskRepo.get(task.id)
    expect(after?.dueDate).toBe('2026-09-07')
    expect(after?.dueTime).toBe('19:00')
  })

  it('creates a task through the existing executor', async () => {
    const confirmation = await propose([step(add('Revise recursion'))])

    expect(await taskRepo.listLive()).toHaveLength(0)

    const outcome = await confirmAiAction(confirmation?.id ?? '')
    expect(outcome.status).toBe('executed')

    const tasks = await taskRepo.listLive()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toBe('Revise recursion')
    expect(tasks[0]?.dueDate).toBe('2026-09-07')
    expect(tasks[0]?.priority).toBe('high')
    expect(tasks[0]?.estimateMin).toBe(45)
  })

  it('writes exactly the events the existing command writes', async () => {
    await createTask({ title: 'Study Java' })
    const before = await eventCount()

    const confirmation = await propose([step(complete('Study Java'))])
    expect(await eventCount()).toBe(before)

    await confirmAiAction(confirmation?.id ?? '')

    // One event, from the executor. Nothing emits a second AI-specific one.
    expect(await eventCount()).toBe(before + 1)
    // Attributed to the assistant by the executor itself — nothing here emits a
    // second AI-specific event alongside it.
    const sources = (await eventRepo.list()).map((event) => event.source)
    expect(sources.filter((source) => source === 'ai')).toHaveLength(1)
  })

  it('passes the executor’s own undo back, without a second implementation', async () => {
    const task = await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])

    const outcome = await confirmAiAction(confirmation?.id ?? '')
    if (outcome.status !== 'executed') throw new Error('expected execution')

    expect(outcome.undo).toEqual([
      { kind: 'task.uncomplete', source: 'ai', raw: '', ref: { by: 'id', id: task.id } },
    ])
  })

  it('never re-parses the user’s text', async () => {
    // `executeText` would re-run the parser over the original sentence, which
    // could mean something different by now. Only the pinned intent runs.
    const spy = vi.spyOn(executor, 'executeText')
    await createTask({ title: 'Study Java' })

    const confirmation = await propose([step(complete('Study Java'))])
    await confirmAiAction(confirmation?.id ?? '')

    expect(spy).not.toHaveBeenCalled()
  })

  it('never re-resolves a name', async () => {
    const spy = vi.spyOn(executor, 'resolveChoice')
    await createTask({ title: 'Study Java' })

    const confirmation = await propose([step(complete('Study Java'))])
    await confirmAiAction(confirmation?.id ?? '')

    expect(spy).not.toHaveBeenCalled()
  })

  it('never asks the provider anything', async () => {
    // The proposal was made before the user saw it. Confirming is authorisation,
    // not a second conversation.
    const spy = vi.spyOn(platform.ai, 'complete')
    await createTask({ title: 'Study Java' })

    const confirmation = await propose([step(complete('Study Java'))])
    await confirmAiAction(confirmation?.id ?? '')

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('single use', () => {
  it('refuses a second confirmation of the same proposal', async () => {
    const task = await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])
    const id = confirmation?.id ?? ''

    expect((await confirmAiAction(id)).status).toBe('executed')

    const replay = await confirmAiAction(id)
    expect(replay.status).toBe('refused')
    if (replay.status !== 'refused') return
    expect(replay.reason).toBe('consumed')

    // And the task was completed once, not twice.
    expect((await taskRepo.get(task.id))?.status).toBe('done')
  })

  it('executes once when two confirmations race', async () => {
    // A double click, or two windows. The state moves out of `pending` before
    // the first `await`, so the second call cannot also get through.
    await createTask({ title: 'Study Java' })
    const spy = vi.spyOn(executor, 'execute')
    const confirmation = await propose([step(complete('Study Java'))])
    const id = confirmation?.id ?? ''

    const [first, second] = await Promise.all([confirmAiAction(id), confirmAiAction(id)])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual(['executed', 'refused'])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('adds exactly one task when a creation is double-confirmed', async () => {
    const confirmation = await propose([step(add('Revise recursion'))])
    const id = confirmation?.id ?? ''

    await Promise.all([confirmAiAction(id), confirmAiAction(id)])

    expect(await taskRepo.listLive()).toHaveLength(1)
  })
})

describe('cancelling', () => {
  it('stops the action and changes nothing', async () => {
    const task = await createTask({ title: 'Study Java' })
    const before = await eventCount()
    const confirmation = await propose([step(complete('Study Java'))])
    const id = confirmation?.id ?? ''

    expect(cancelAiConfirmation(id)).toBe(true)

    const outcome = await confirmAiAction(id)
    expect(outcome.status).toBe('refused')
    if (outcome.status !== 'refused') return
    expect(outcome.reason).toBe('cancelled')

    expect((await taskRepo.get(task.id))?.status).toBe('todo')
    expect(await eventCount()).toBe(before)
  })

  it('reports that a second cancel had nothing to do', async () => {
    await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])
    const id = confirmation?.id ?? ''

    expect(cancelAiConfirmation(id)).toBe(true)
    expect(cancelAiConfirmation(id)).toBe(false)
  })

  it('cannot cancel a proposal that already ran', async () => {
    await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])
    const id = confirmation?.id ?? ''

    await confirmAiAction(id)
    expect(cancelAiConfirmation(id)).toBe(false)
  })
})

describe('expiry', () => {
  it('refuses a proposal older than its lifetime, and runs nothing', async () => {
    const task = await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])
    const id = confirmation?.id ?? ''

    // Taken from the proposal itself: the test clock advances a millisecond per
    // call, so `createdAt` is already a few ticks past `NOW`.
    const lapsed = (confirmation?.expiresAt ?? 0) + 1
    expect(lapsed).toBeGreaterThan(NOW.getTime() + AI_CONFIRMATION_TTL_MS)
    vi.spyOn(platform.clock, 'now').mockReturnValue(lapsed)

    const outcome = await confirmAiAction(id)
    expect(outcome.status).toBe('refused')
    if (outcome.status !== 'refused') return
    expect(outcome.reason).toBe('expired')

    expect((await taskRepo.get(task.id))?.status).toBe('todo')
  })

  it('still stands a moment before it lapses', async () => {
    await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])
    const id = confirmation?.id ?? ''

    vi.spyOn(platform.clock, 'now').mockReturnValue((confirmation?.expiresAt ?? 0) - 1)

    expect((await confirmAiAction(id)).status).toBe('executed')
  })

  it('reads as expired without being confirmed', async () => {
    await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])
    const id = confirmation?.id ?? ''

    vi.spyOn(platform.clock, 'now').mockReturnValue(confirmation?.expiresAt ?? 0)
    expect(getAiConfirmation(id)?.state).toBe('expired')
  })
})

describe('restart', () => {
  it('makes an old proposal unusable once the state is recreated', async () => {
    const task = await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])
    const id = confirmation?.id ?? ''

    // What a restart does: the in-memory map is simply gone.
    resetAiConfirmations()

    expect(getAiConfirmation(id)).toBeNull()
    const outcome = await confirmAiAction(id)
    expect(outcome.status).toBe('refused')
    if (outcome.status !== 'refused') return
    expect(outcome.reason).toBe('unknown')

    expect((await taskRepo.get(task.id))?.status).toBe('todo')
  })

  it('refuses an id that was never issued', async () => {
    const outcome = await confirmAiAction('not-a-real-confirmation')
    expect(outcome.status).toBe('refused')
    if (outcome.status !== 'refused') return
    expect(outcome.reason).toBe('unknown')
  })
})

describe('a multi-step plan', () => {
  it('holds every step behind one confirmation', async () => {
    const java = await createTask({ title: 'Study Java' })
    const confirmation = await propose([
      step(complete('Study Java'), 'step-1', 'Complete it'),
      step(add('Revise recursion'), 'step-2', 'Add revision'),
    ])

    expect(confirmation?.summary).toEqual([
      'Complete task: “Study Java”',
      'Add task: “Revise recursion” · Tomorrow · high priority · 45m',
    ])

    // Nothing has run: not step one, not step two.
    expect((await taskRepo.get(java.id))?.status).toBe('todo')
    expect(await taskRepo.listLive()).toHaveLength(1)

    const outcome = await confirmAiAction(confirmation?.id ?? '')
    expect(outcome.status).toBe('executed')
    expect((await taskRepo.get(java.id))?.status).toBe('done')
    expect(await taskRepo.listLive()).toHaveLength(2)
  })

  it('stops at the first failure and does not attempt what follows', async () => {
    /*
     * Honest about what this is: execution is sequential and *not* atomic —
     * each command is its own transaction with its own event, and Vaultwork has
     * no multi-command transaction to reuse. So the first step stays applied.
     * What the gate guarantees is that the remaining steps are not attempted,
     * and that the failure is reported rather than papered over.
     */
    const java = await createTask({ title: 'Study Java' })
    const doomed = await createTask({ title: 'Revise recursion' })

    const confirmation = await propose([
      step(complete('Study Java'), 'step-1'),
      step(complete('Revise recursion'), 'step-2'),
      step(add('Third thing'), 'step-3'),
    ])

    // The second target disappears between proposal and confirmation.
    await deleteTask(doomed.id)

    const outcome = await confirmAiAction(confirmation?.id ?? '')

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.results).toHaveLength(2)
    expect(outcome.results[0]?.status).toBe('ok')
    expect(outcome.results[1]?.status).not.toBe('ok')

    // Step one applied; step three was never attempted.
    expect((await taskRepo.get(java.id))?.status).toBe('done')
    expect((await taskRepo.listLive()).some((task) => task.title === 'Third thing')).toBe(false)

    // And what did run is undoable, through the executor's own undo.
    expect(outcome.undo).toHaveLength(1)
  })
})

describe('stale data', () => {
  it('lets the executor refuse a target that has gone, and does not substitute another', async () => {
    const task = await createTask({ title: 'Study Java' })
    const other = await createTask({ title: 'Study Java thoroughly' })
    const confirmation = await propose([step(complete('Study Java'))])

    await deleteTask(task.id)

    const outcome = await confirmAiAction(confirmation?.id ?? '')

    expect(outcome.status).toBe('failed')
    // No fallback resolution onto the similarly named task.
    expect((await taskRepo.get(other.id))?.status).toBe('todo')
  })

  it('does not retry, and asks the provider nothing, when a step fails', async () => {
    const provider = vi.spyOn(platform.ai, 'complete')
    const task = await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])
    await deleteTask(task.id)

    const execute = vi.spyOn(executor, 'execute')
    await confirmAiAction(confirmation?.id ?? '')

    expect(execute).toHaveBeenCalledTimes(1)
    expect(provider).not.toHaveBeenCalled()
  })

  it('reports the executor’s own message rather than inventing one', async () => {
    const task = await createTask({ title: 'Study Java' })
    const confirmation = await propose([step(complete('Study Java'))])
    await deleteTask(task.id)

    const outcome = await confirmAiAction(confirmation?.id ?? '')
    if (outcome.status !== 'failed') throw new Error('expected failure')

    expect(outcome.message).toBe(outcome.results[0]?.message)
  })
})

describe('the pinned intent cannot be swapped', () => {
  it('exposes no way to confirm a different command', () => {
    // Structural: the public API takes an id and nothing else, so there is no
    // `confirm(id, replacementIntent)` to misuse.
    expect(confirmAiAction).toHaveLength(1)
    expect(cancelAiConfirmation).toHaveLength(1)
    expect(getAiConfirmation).toHaveLength(1)
  })

  it('runs the pinned intent even if the stored object is mutated afterwards', async () => {
    const task = await createTask({ title: 'Study Java' })
    const other = await createTask({ title: 'Something else' })
    const confirmation = await propose([step(complete('Study Java'))])

    // A caller holding the returned object tries to retarget it.
    const tampered = confirmation as unknown as { intents: unknown[] }
    try {
      tampered.intents = [
        { kind: 'task.complete', source: 'ai', raw: RAW, ref: { by: 'id', id: other.id } },
      ]
    } catch {
      // A frozen object would be fine too.
    }

    await confirmAiAction(confirmation?.id ?? '')

    // The stored proposal decided, not the caller's copy.
    expect((await taskRepo.get(task.id))?.status).toBe('done')
    expect((await taskRepo.get(other.id))?.status).toBe('todo')
  })
})
