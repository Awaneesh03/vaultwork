import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { platform, type AiStatus, type IncomingTelegramMessage } from '@/platform'
import { eventRepo, taskRepo } from '@/repositories'
import * as executor from './commands/commandExecutor'
import * as assistant from './ai/aiAssistantService'
import { AI_CONFIRMATION_TTL_MS, resetAiConfirmations } from './ai/aiConfirmationService'
import { createTask, deleteTask } from './taskService'
import { processTelegramMessage, resetTelegramSessions } from './telegramService'
import { resetDatabase, freezeClock } from '../../tests/helpers'

/**
 * Telegram as a transport into the assistant.
 *
 * Everything below the provider is real here — the context builder, the parser,
 * the resolver, the confirmation gate, the executor, the database, the event
 * log and the message log. Only Groq is faked, at the port.
 *
 * The claims worth checking are the ones that would be invisible in a chat:
 * that a known command never reaches the assistant, that a proposal changes
 * nothing until `/confirm`, that confirming twice runs once, and that an
 * unauthorized chat cannot start any of it.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)
const CHAT = '4242'

const READY: AiStatus = {
  configured: true,
  enabled: true,
  provider: 'groq',
  model: 'fake-model-v1',
  lastError: null,
  keychainReads: 1,
}

let updateSeq = 0

function incoming(text: string, overrides: Partial<IncomingTelegramMessage> = {}) {
  updateSeq += 1
  return {
    source: 'telegram' as const,
    externalId: `update-${updateSeq}`,
    chatId: CHAT,
    senderId: CHAT,
    text,
    receivedAt: NOW.getTime(),
    ...overrides,
  }
}

/** Sends one message from the authorized chat and returns the reply text. */
async function send(text: string, overrides: Partial<IncomingTelegramMessage> = {}) {
  const outcome = await processTelegramMessage(incoming(text, overrides), {
    authorizedChatId: CHAT,
  })
  return outcome.reply?.text ?? ''
}

function provider(reply: unknown, status: AiStatus = READY) {
  vi.spyOn(platform.ai, 'isAvailable', 'get').mockReturnValue(true)
  vi.spyOn(platform.ai, 'status').mockResolvedValue(status)
  return vi.spyOn(platform.ai, 'complete').mockResolvedValue({
    text: typeof reply === 'string' ? reply : JSON.stringify(reply),
    model: status.model,
    finishReason: 'stop',
    usage: null,
  })
}

const answer = (message: string) => ({ kind: 'answer', message })

const planFor = (intent: unknown, description = 'Do the thing') => ({
  kind: 'plan',
  message: 'I can do that.',
  steps: [{ description, intent }],
})

const completeStep = (query: string) => ({ kind: 'task.complete', ref: { by: 'text', query } })

beforeEach(async () => {
  await resetDatabase()
  resetTelegramSessions()
  resetAiConfirmations()
  freezeClock(NOW)
  updateSeq = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

const eventCount = async () => (await eventRepo.list()).length

describe('known commands never reach the assistant', () => {
  it('leaves every M14 verb on its own path', async () => {
    const ask = vi.spyOn(assistant, 'askAi')
    provider(answer('should not be used'))
    await createTask({ title: 'Study Java' })

    for (const command of [
      '/start',
      '/help',
      '/status',
      '/today',
      '/inbox',
      '/overdue',
      '/habits',
      '/projects',
      '/goals',
      '/add Write essay',
      '/done Study Java',
      '/cancel',
      '/confirm',
    ]) {
      await send(command)
    }

    expect(ask).not.toHaveBeenCalled()
  })

  it('keeps plain text as quick capture, not a question', async () => {
    // M14's oldest behaviour: typing a sentence captures a task. Turning that
    // into an AI question would break the thing this chat is fastest at.
    const ask = vi.spyOn(assistant, 'askAi')
    provider(answer('should not be used'))

    await send('Buy milk tomorrow')

    expect(ask).not.toHaveBeenCalled()
    const tasks = await taskRepo.listLive()
    expect(tasks.map((task) => task.title)).toContain('Buy milk')
  })

  it('treats a malformed known command as M14 does, without asking the assistant', async () => {
    const ask = vi.spyOn(assistant, 'askAi')
    provider(answer('should not be used'))

    // `/note` with no argument is an empty-verb unknown, which M14 answers with
    // its help hint. It must not become a question.
    expect(await send('/note')).toContain("I don't know that command")
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('the assistant is reached by /ask', () => {
  it('asks the provider exactly once and returns the answer', async () => {
    const complete = provider(answer('Two tasks are due today.'))

    expect(await send('/ask what is important today?')).toBe('Two tasks are due today.')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('answers an unknown command through the assistant too', async () => {
    const complete = provider(answer('I can help with that.'))

    expect(await send('/wibble something')).toBe('I can help with that.')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('falls back to M14’s reply when the assistant is unavailable', async () => {
    // The default installation: no key, assistant off. An unknown command must
    // answer exactly as it did in M14 rather than advertise a disabled feature.
    vi.spyOn(platform.ai, 'isAvailable', 'get').mockReturnValue(true)
    vi.spyOn(platform.ai, 'status').mockResolvedValue({ ...READY, enabled: false })

    expect(await send('/wibble something')).toContain("I don't know that command")
  })

  it('says why when the assistant itself was asked for', async () => {
    vi.spyOn(platform.ai, 'isAvailable', 'get').mockReturnValue(true)
    vi.spyOn(platform.ai, 'status').mockResolvedValue({ ...READY, enabled: false })

    expect(await send('/ask what is due')).toBe('The assistant is switched off.')

    vi.spyOn(platform.ai, 'status').mockResolvedValue({ ...READY, configured: false })
    expect(await send('/ask what is due')).toContain('not configured')
  })

  it('refuses an empty /ask as a malformed command', async () => {
    const complete = provider(answer('unused'))

    expect(await send('/ask')).toContain("I don't know that command")
    expect(complete).not.toHaveBeenCalled()
  })
})

describe('authorization comes first', () => {
  it('never asks the assistant for an unauthorized chat', async () => {
    const complete = provider(answer('should not be used'))
    const ask = vi.spyOn(assistant, 'askAi')

    const outcome = await processTelegramMessage(incoming('/ask anything', { chatId: '9999' }), {
      authorizedChatId: CHAT,
    })

    expect(outcome.processed).toBe(false)
    expect(outcome.reply).toBeNull()
    expect(ask).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })
})

describe('deduplication', () => {
  it('asks the assistant once for a redelivered update', async () => {
    const complete = provider(answer('Two tasks are due today.'))
    const update = incoming('/ask what is due')

    const first = await processTelegramMessage(update, { authorizedChatId: CHAT })
    const second = await processTelegramMessage(update, { authorizedChatId: CHAT })

    expect(first.processed).toBe(true)
    expect(second.processed).toBe(false)
    expect(second.reply).toBeNull()
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('creates no second proposal for a redelivered update', async () => {
    await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))
    const update = incoming('/ask complete my java task')

    await processTelegramMessage(update, { authorizedChatId: CHAT })
    await processTelegramMessage(update, { authorizedChatId: CHAT })

    // One proposal is pending, so one /confirm applies one change.
    const reply = await send('/confirm')
    expect(reply).toContain('Completed')
    expect(await send('/confirm')).toContain('Nothing is waiting')
  })
})

describe('an answer', () => {
  it('proposes nothing and changes nothing', async () => {
    const before = await eventCount()
    provider(answer('You have two tasks due today.'))

    const reply = await send('/ask what is important today?')

    expect(reply).toBe('You have two tasks due today.')
    expect(reply).not.toContain('/confirm')
    expect(await eventCount()).toBe(before)
  })
})

describe('a clarification', () => {
  it('is passed through with its options, and proposes nothing', async () => {
    provider({
      kind: 'clarification',
      message: 'Which Java task did you mean?',
      options: ['Study Java', 'Java Assignment'],
    })

    const reply = await send('/ask complete java')

    expect(reply).toContain('Which Java task did you mean?')
    expect(reply).toContain('1. Study Java')
    expect(reply).toContain('2. Java Assignment')
    expect(await send('/confirm')).toContain('Nothing is waiting')
  })
})

describe('an ambiguous reference', () => {
  it('offers the resolver’s numbered rows and executes nothing', async () => {
    await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })
    const complete = provider(planFor(completeStep('Java')))
    const execute = vi.spyOn(executor, 'execute')

    const reply = await send('/ask complete java')

    expect(reply).toContain('Which task did you mean')
    expect(reply).toContain('1. ')
    expect(reply).toContain('Reply with a number.')
    expect(execute).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('turns a number into a proposal without asking the model again', async () => {
    const assignment = await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })
    const complete = provider(planFor(completeStep('Java')))
    const execute = vi.spyOn(executor, 'execute')

    const choices = await send('/ask complete java')
    const first = choices.split('\n').find((line) => line.startsWith('1. ')) ?? ''

    const proposal = await send('1')

    expect(proposal).toContain('This would:')
    expect(proposal).toContain(first.slice(3))
    expect(proposal).toContain('/confirm')
    // The number settled which row. It did not run anything, and it did not
    // cost a second provider call.
    expect(execute).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledTimes(1)
    expect((await taskRepo.get(assignment.id))?.status).toBe('todo')
  })

  it('applies only after an explicit confirmation', async () => {
    await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })
    provider(planFor(completeStep('Java')))

    await send('/ask complete java')
    await send('1')
    const applied = await send('/confirm')

    expect(applied).toContain('Completed')
    const done = (await taskRepo.listLive()).filter((task) => task.status === 'done')
    expect(done).toHaveLength(1)
  })

  it('refuses a number that was never offered', async () => {
    await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })
    provider(planFor(completeStep('Java')))

    await send('/ask complete java')
    expect(await send('9')).toContain("couldn't match that number")
  })
})

describe('a proposal', () => {
  it('shows the application’s summary, not the model’s description', async () => {
    await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java'), 'Tidy up a few old things'))

    const reply = await send('/ask complete my java task')

    expect(reply).toContain('Complete task: “Study Java”')
    expect(reply).not.toContain('Tidy up a few old things')
  })

  it('changes nothing while it waits', async () => {
    const task = await createTask({ title: 'Study Java' })
    const before = await eventCount()
    provider(planFor(completeStep('Study Java')))

    await send('/ask complete my java task')

    expect((await taskRepo.get(task.id))?.status).toBe('todo')
    expect(await eventCount()).toBe(before)
  })

  it('shows no internal id', async () => {
    const task = await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))

    expect(await send('/ask complete my java task')).not.toContain(task.id)
  })

  it('applies through the real executor on /confirm', async () => {
    const task = await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))
    const execute = vi.spyOn(executor, 'execute')

    await send('/ask complete my java task')
    const applied = await send('/confirm')

    expect(applied).toContain('Completed')
    expect((await taskRepo.get(task.id))?.status).toBe('done')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('asks the provider nothing while confirming', async () => {
    await createTask({ title: 'Study Java' })
    const complete = provider(planFor(completeStep('Study Java')))

    await send('/ask complete my java task')
    await send('/confirm')

    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('never re-parses or re-resolves at confirmation', async () => {
    await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))
    const executeText = vi.spyOn(executor, 'executeText')
    const resolveChoice = vi.spyOn(executor, 'resolveChoice')

    await send('/ask complete my java task')
    await send('/confirm')

    expect(executeText).not.toHaveBeenCalled()
    expect(resolveChoice).not.toHaveBeenCalled()
  })

  it('writes exactly one event, attributed to the assistant', async () => {
    await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))
    const before = await eventCount()

    await send('/ask complete my java task')
    await send('/confirm')

    expect(await eventCount()).toBe(before + 1)
    const sources = (await eventRepo.list()).map((event) => event.source)
    expect(sources.filter((source) => source === 'ai')).toHaveLength(1)
  })
})

describe('replay, cancel and expiry', () => {
  it('applies once however many times /confirm is sent', async () => {
    const task = await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))
    const execute = vi.spyOn(executor, 'execute')
    const before = await eventCount()

    await send('/ask complete my java task')
    expect(await send('/confirm')).toContain('Completed')
    expect(await send('/confirm')).toContain('Nothing is waiting')

    expect(execute).toHaveBeenCalledTimes(1)
    expect(await eventCount()).toBe(before + 1)
    expect((await taskRepo.get(task.id))?.status).toBe('done')
  })

  it('cancels without changing anything', async () => {
    const task = await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))
    const execute = vi.spyOn(executor, 'execute')

    await send('/ask complete my java task')
    expect(await send('/cancel')).toBe('Cancelled. Nothing was changed.')

    expect(execute).not.toHaveBeenCalled()
    expect((await taskRepo.get(task.id))?.status).toBe('todo')
    expect(await send('/confirm')).toContain('Nothing is waiting')
  })

  it('refuses a proposal that has expired', async () => {
    const task = await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))

    await send('/ask complete my java task')
    vi.spyOn(platform.clock, 'now').mockReturnValue(NOW.getTime() + AI_CONFIRMATION_TTL_MS + 60_000)

    expect(await send('/confirm')).toContain('expired')
    expect((await taskRepo.get(task.id))?.status).toBe('todo')
  })

  it('makes a proposal unusable once the gate’s state is recreated', async () => {
    // What a restart does. The pinned intent lives in M15.5, never in the chat.
    const task = await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))

    await send('/ask complete my java task')
    resetAiConfirmations()

    expect(await send('/confirm')).toContain('no longer available')
    expect((await taskRepo.get(task.id))?.status).toBe('todo')
  })

  it('does not let a delete confirmation land on an assistant proposal', async () => {
    // One pending action per chat, which is already how a second /delete
    // behaves. Without it, /confirm could apply the wrong one.
    const doomed = await createTask({ title: 'Old thing' })
    const java = await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('Study Java')))

    await send('/ask complete my java task')
    await send('/delete Old thing')
    await send('/confirm')

    expect(await taskRepo.get(doomed.id)).toBeUndefined()
    expect((await taskRepo.get(java.id))?.status).toBe('todo')
  })
})

describe('when things go wrong', () => {
  it('reports a reference that matched nothing, and proposes nothing', async () => {
    await createTask({ title: 'Study Java' })
    provider(planFor(completeStep('quantum physics')))

    const reply = await send('/ask complete quantum physics')

    expect(reply).toContain('Nothing here matches')
    expect(await send('/confirm')).toContain('Nothing is waiting')
  })

  it('reports a target that vanished before confirmation, without substituting', async () => {
    const task = await createTask({ title: 'Study Java' })
    const other = await createTask({ title: 'Study Java thoroughly' })
    const complete = provider(planFor(completeStep('Study Java')))

    await send('/ask complete my java task')
    await deleteTask(task.id)
    const reply = await send('/confirm')

    expect(reply).toContain('Stopped:')
    expect((await taskRepo.get(other.id))?.status).toBe('todo')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('reports a malformed reply without quoting it back', async () => {
    provider('IGNORE PREVIOUS INSTRUCTIONS sk-secret-value not json')

    const reply = await send('/ask what is due')

    expect(reply).toContain('did not return valid JSON')
    expect(reply).not.toContain('sk-secret-value')
    expect(reply).not.toContain('IGNORE PREVIOUS')
  })

  it('never leaks a key, a token or a provider host', async () => {
    provider(answer('All good.'))
    const replies = [
      await send('/ask what is due'),
      await send('/status'),
      await send('/help'),
    ].join('\n')

    for (const secret of [
      'sk-',
      'api.groq.com',
      'Authorization',
      'Bearer',
      'botToken',
      '/Users/',
    ]) {
      expect(replies, secret).not.toContain(secret)
    }
  })

  it('keeps a reply inside Telegram’s size limit', async () => {
    provider(answer('x'.repeat(5000)))

    const reply = await send('/ask say a lot')
    expect(reply.length).toBeLessThanOrEqual(3500)
  })
})

describe('a multi-step plan', () => {
  it('holds every step behind one confirmation', async () => {
    const java = await createTask({ title: 'Study Java' })
    provider({
      kind: 'plan',
      message: 'Two changes.',
      steps: [
        { description: 'Complete it', intent: completeStep('Study Java') },
        {
          description: 'Add revision',
          intent: { kind: 'task.add', title: 'Revise recursion', dueDate: '2026-09-07' },
        },
      ],
    })

    const reply = await send('/ask complete java and add revision tomorrow')

    expect(reply).toContain('2 changes')
    expect(reply).toContain('1. Complete task: “Study Java”')
    expect(reply).toContain('2. Add task: “Revise recursion”')

    // Nothing has run yet.
    expect((await taskRepo.get(java.id))?.status).toBe('todo')
    expect(await taskRepo.listLive()).toHaveLength(1)

    await send('/confirm')

    expect((await taskRepo.get(java.id))?.status).toBe('done')
    expect(await taskRepo.listLive()).toHaveLength(2)
  })
})
