import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_LIMITS } from '@/ai/aiTypes'
import { platform, type AiStatus } from '@/platform'
import { eventRepo, taskRepo } from '@/repositories'
import * as executor from '../commands/commandExecutor'
import { createTask, deleteTask } from '../taskService'
import { resetDatabase, freezeClock } from '../../../tests/helpers'
import { askAi, proposeAiChoices } from './aiAssistantService'
import {
  cancelAiConfirmation,
  confirmAiAction,
  resetAiConfirmations,
} from './aiConfirmationService'

/**
 * A whole plan, from a request to a mutation.
 *
 * Planning is where the assistant is most tempting to let off the leash: the
 * request is vague, the answer is several actions, and the obvious next step is
 * to have the model check its own work. So these tests are mostly about what
 * does *not* happen — one provider call, no replanning, nothing applied until
 * one explicit confirmation of the exact plan the user read.
 *
 * Everything below the provider is real: context, parser, resolver, gate,
 * executor, database, event log.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)

const READY: AiStatus = {
  configured: true,
  enabled: true,
  provider: 'groq',
  model: 'fake-model-v1',
  lastError: null,
  keychainReads: 1,
}

function provider(reply: unknown) {
  vi.spyOn(platform.ai, 'isAvailable', 'get').mockReturnValue(true)
  vi.spyOn(platform.ai, 'status').mockResolvedValue(READY)
  return vi.spyOn(platform.ai, 'complete').mockResolvedValue({
    text: typeof reply === 'string' ? reply : JSON.stringify(reply),
    model: READY.model,
    finishReason: 'stop',
    usage: null,
  })
}

const completeStep = (query: string) => ({ kind: 'task.complete', ref: { by: 'text', query } })
const rescheduleStep = (query: string, dueDate = '2026-09-07', dueTime = '19:00') => ({
  kind: 'task.reschedule',
  ref: { by: 'text', query },
  dueDate,
  dueTime,
})
const addStep = (title: string) => ({ kind: 'task.add', title, dueDate: '2026-09-07' })

const planReply = (steps: { description: string; intent: unknown }[], message = 'Here is a plan.') => ({
  kind: 'plan',
  message,
  steps,
})

beforeEach(async () => {
  await resetDatabase()
  resetAiConfirmations()
  freezeClock(NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const eventCount = async () => (await eventRepo.list()).length

describe('a planning request', () => {
  it('produces one provider call and one confirmation for the whole plan', async () => {
    const java = await createTask({ title: 'Study Java' })
    const essay = await createTask({ title: 'Write essay' })
    const complete = provider(
      planReply([
        { description: 'Finish the Java work', intent: completeStep('Study Java') },
        { description: 'Move the essay to tomorrow', intent: rescheduleStep('Write essay') },
        { description: 'Add the follow-up', intent: addStep('Review recursion') },
      ]),
    )

    const result = await askAi('help me organise my overdue work')

    expect(result.kind).toBe('proposal')
    if (result.kind !== 'proposal') return

    // One confirmation covering three actions — not three confirmations.
    expect(result.confirmation.summary).toHaveLength(3)
    expect(complete).toHaveBeenCalledTimes(1)

    // And nothing has happened yet.
    expect((await taskRepo.get(java.id))?.status).toBe('todo')
    expect((await taskRepo.get(essay.id))?.dueDate).toBeNull()
    expect(await taskRepo.listLive()).toHaveLength(2)
  })

  it('routes to the planning context profile', async () => {
    await createTask({ title: 'Study Java' })
    const complete = provider(planReply([{ description: 'x', intent: completeStep('Study Java') }]))

    await askAi('help me organise my overdue work')

    const request = complete.mock.calls[0]?.[0]
    const context = request?.messages.find((message) => message.content.includes('"purpose"'))
    expect(context?.content).toContain('"purpose":"planning"')
  })

  it('summarises from the application, not the model’s prose', async () => {
    await createTask({ title: 'Study Java' })
    provider(
      planReply(
        [{ description: 'Tidy up a few old things', intent: completeStep('Study Java') }],
        'I will clean up your workload.',
      ),
    )

    const result = await askAi('organise my work')
    if (result.kind !== 'proposal') throw new Error('expected a proposal')

    expect(result.confirmation.summary).toEqual(['Complete task: “Study Java”'])
    // The model's words survive as context only.
    expect(result.confirmation.aiDescriptions).toEqual(['Tidy up a few old things'])
  })

  it('applies every step, in order, on one confirmation', async () => {
    const java = await createTask({ title: 'Study Java' })
    const essay = await createTask({ title: 'Write essay' })
    provider(
      planReply([
        { description: 'a', intent: completeStep('Study Java') },
        { description: 'b', intent: rescheduleStep('Write essay') },
        { description: 'c', intent: addStep('Review recursion') },
      ]),
    )
    const execute = vi.spyOn(executor, 'execute')

    const result = await askAi('organise my work')
    if (result.kind !== 'proposal') throw new Error('expected a proposal')

    const before = await eventCount()
    const outcome = await confirmAiAction(result.confirmation.id)

    expect(outcome.status).toBe('executed')
    expect(execute).toHaveBeenCalledTimes(3)
    expect((await taskRepo.get(java.id))?.status).toBe('done')
    expect((await taskRepo.get(essay.id))?.dueDate).toBe('2026-09-07')
    expect((await taskRepo.listLive()).some((task) => task.title === 'Review recursion')).toBe(true)

    // One event per command, all attributed to the assistant.
    expect(await eventCount()).toBe(before + 3)
    const sources = (await eventRepo.list()).map((event) => event.source)
    expect(sources.filter((source) => source === 'ai')).toHaveLength(3)
  })
})

describe('the plan is bounded', () => {
  it('refuses a plan with more steps than a person can review', async () => {
    const steps = Array.from({ length: AI_LIMITS.steps + 1 }, (_, i) => ({
      description: `step ${i}`,
      intent: addStep(`Task ${i}`),
    }))
    provider(planReply(steps))

    const result = await askAi('plan my whole month')

    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.message).toContain(String(AI_LIMITS.steps))
  })

  it('refuses rather than applying the first few steps', async () => {
    const steps = Array.from({ length: AI_LIMITS.steps + 3 }, (_, i) => ({
      description: `step ${i}`,
      intent: addStep(`Task ${i}`),
    }))
    provider(planReply(steps))
    const execute = vi.spyOn(executor, 'execute')

    await askAi('plan my whole month')

    expect(execute).not.toHaveBeenCalled()
    expect(await taskRepo.listLive()).toHaveLength(0)
  })

  it('accepts a plan exactly at the limit', async () => {
    const steps = Array.from({ length: AI_LIMITS.steps }, (_, i) => ({
      description: `step ${i}`,
      intent: addStep(`Task ${i}`),
    }))
    provider(planReply(steps))

    const result = await askAi('plan my week')
    expect(result.kind).toBe('proposal')
  })
})

describe('a plan that cannot work', () => {
  it('explains a step that acts on what the plan is creating', async () => {
    provider(
      planReply([
        { description: 'Add it', intent: addStep('Review recursion') },
        { description: 'Then finish it', intent: completeStep('Review recursion') },
      ]),
    )

    const result = await askAi('plan my evening')

    expect(result.kind).toBe('unresolved')
    if (result.kind !== 'unresolved') return
    expect(result.message).toContain('while also creating it')
  })

  it('creates no confirmation and applies nothing', async () => {
    provider(
      planReply([
        { description: 'Add it', intent: addStep('Review recursion') },
        { description: 'Then finish it', intent: completeStep('Review recursion') },
      ]),
    )
    const execute = vi.spyOn(executor, 'execute')

    await askAi('plan my evening')

    expect(execute).not.toHaveBeenCalled()
    expect(await taskRepo.listLive()).toHaveLength(0)
  })

  it('refuses a whole plan when one step names nothing', async () => {
    await createTask({ title: 'Study Java' })
    provider(
      planReply([
        { description: 'a', intent: completeStep('Study Java') },
        { description: 'b', intent: completeStep('quantum physics') },
      ]),
    )
    const execute = vi.spyOn(executor, 'execute')

    const result = await askAi('plan my evening')

    expect(result.kind).toBe('unresolved')
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('a plan the assistant is unsure about', () => {
  it('asks rather than proposing, when a step is ambiguous', async () => {
    await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })
    provider(planReply([{ description: 'a', intent: completeStep('Java') }]))
    const execute = vi.spyOn(executor, 'execute')

    const result = await askAi('plan my evening')

    expect(result.kind).toBe('choices')
    expect(execute).not.toHaveBeenCalled()
  })

  it('creates no partial confirmation when only one of two steps is ambiguous', async () => {
    // The resolved step must not become separately runnable. A plan is
    // confirmed whole or not at all.
    await createTask({ title: 'Write essay' })
    await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })
    provider(
      planReply([
        { description: 'a', intent: completeStep('Write essay') },
        { description: 'b', intent: completeStep('Java') },
      ]),
    )

    const result = await askAi('plan my evening')

    expect(result.kind).toBe('choices')
    if (result.kind !== 'choices') return
    expect(result.steps.map((step) => step.status)).toEqual(['resolved', 'ambiguous'])
  })

  it('becomes one confirmation once every question is answered', async () => {
    const essay = await createTask({ title: 'Write essay' })
    const assignment = await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })
    const complete = provider(
      planReply([
        { description: 'a', intent: completeStep('Write essay') },
        { description: 'b', intent: completeStep('Java') },
      ]),
    )

    const result = await askAi('plan my evening')
    if (result.kind !== 'choices') throw new Error('expected choices')

    const ambiguous = result.steps.find((step) => step.status === 'ambiguous')
    if (ambiguous?.status !== 'ambiguous') throw new Error('expected an ambiguous step')

    const confirmation = await proposeAiChoices(
      result.steps,
      new Map([[ambiguous.id, assignment.id]]),
    )

    expect(confirmation?.summary).toHaveLength(2)
    // Answering a question costs no provider call.
    expect(complete).toHaveBeenCalledTimes(1)

    await confirmAiAction(confirmation?.id ?? '')
    expect((await taskRepo.get(essay.id))?.status).toBe('done')
    expect((await taskRepo.get(assignment.id))?.status).toBe('done')
  })
})

describe('the plan is pinned, single-use and expiring', () => {
  it('applies once however many times it is confirmed', async () => {
    const java = await createTask({ title: 'Study Java' })
    provider(planReply([{ description: 'a', intent: completeStep('Study Java') }]))
    const execute = vi.spyOn(executor, 'execute')

    const result = await askAi('plan my evening')
    if (result.kind !== 'proposal') throw new Error('expected a proposal')

    expect((await confirmAiAction(result.confirmation.id)).status).toBe('executed')
    expect((await confirmAiAction(result.confirmation.id)).status).toBe('refused')

    expect(execute).toHaveBeenCalledTimes(1)
    expect((await taskRepo.get(java.id))?.status).toBe('done')
  })

  it('applies nothing when cancelled', async () => {
    const java = await createTask({ title: 'Study Java' })
    provider(planReply([{ description: 'a', intent: completeStep('Study Java') }]))

    const result = await askAi('plan my evening')
    if (result.kind !== 'proposal') throw new Error('expected a proposal')

    expect(cancelAiConfirmation(result.confirmation.id)).toBe(true)
    expect((await confirmAiAction(result.confirmation.id)).status).toBe('refused')
    expect((await taskRepo.get(java.id))?.status).toBe('todo')
  })

  it('applies nothing once it has expired, and is not regenerated', async () => {
    const java = await createTask({ title: 'Study Java' })
    const complete = provider(planReply([{ description: 'a', intent: completeStep('Study Java') }]))

    const result = await askAi('plan my evening')
    if (result.kind !== 'proposal') throw new Error('expected a proposal')

    vi.spyOn(platform.clock, 'now').mockReturnValue(result.confirmation.expiresAt + 1)

    const outcome = await confirmAiAction(result.confirmation.id)
    expect(outcome.status).toBe('refused')
    if (outcome.status !== 'refused') return
    expect(outcome.reason).toBe('expired')

    expect((await taskRepo.get(java.id))?.status).toBe('todo')
    // No second attempt at the provider to rebuild it.
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('runs the pinned plan even after the target changes name', async () => {
    const java = await createTask({ title: 'Study Java' })
    provider(planReply([{ description: 'a', intent: completeStep('Study Java') }]))

    const result = await askAi('plan my evening')
    if (result.kind !== 'proposal') throw new Error('expected a proposal')

    // The id was pinned at resolution, so a rename cannot redirect it.
    const intent = result.confirmation.intents[0]
    if (intent?.kind !== 'task.complete') throw new Error('expected task.complete')
    expect(intent.ref).toEqual({ by: 'id', id: java.id })
  })
})

describe('nothing recovers by itself', () => {
  it('stops at a failed step and asks the provider nothing', async () => {
    const java = await createTask({ title: 'Study Java' })
    const doomed = await createTask({ title: 'Write essay' })
    const complete = provider(
      planReply([
        { description: 'a', intent: completeStep('Study Java') },
        { description: 'b', intent: completeStep('Write essay') },
        { description: 'c', intent: addStep('Never reached') },
      ]),
    )

    const result = await askAi('plan my evening')
    if (result.kind !== 'proposal') throw new Error('expected a proposal')

    await deleteTask(doomed.id)
    const outcome = await confirmAiAction(result.confirmation.id)

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return

    // Sequential and not atomic: step one stands, step three never ran, and
    // nothing tried to repair the plan.
    expect((await taskRepo.get(java.id))?.status).toBe('done')
    expect((await taskRepo.listLive()).some((task) => task.title === 'Never reached')).toBe(false)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(outcome.undo).toHaveLength(1)
  })

  it('never calls the provider more than once for one request', async () => {
    // The autonomy boundary, checked directly. Whatever a plan does — resolve,
    // fail, expire — the model is asked exactly once and never again.
    await createTask({ title: 'Study Java' })
    const complete = provider(
      planReply([
        { description: 'a', intent: completeStep('Study Java') },
        { description: 'b', intent: addStep('Review recursion') },
      ]),
    )

    const result = await askAi('plan my evening')
    if (result.kind !== 'proposal') throw new Error('expected a proposal')
    await confirmAiAction(result.confirmation.id)

    expect(complete).toHaveBeenCalledTimes(1)
  })
})
