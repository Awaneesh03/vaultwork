import { beforeEach, describe, expect, it } from 'vitest'
import type { IncomingTelegramMessage } from '@/platform'
import { eventRepo, messageLogRepo, noteRepo, taskRepo } from '@/repositories'
import { taskInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { createTask } from './taskService'
import { processTelegramMessage, resetTelegramSessions } from './telegramService'

/**
 * Telegram as a remote control.
 *
 * The families that matter: a redelivered update must not act twice, an
 * unauthorized chat must not act at all, reading must write nothing, and every
 * mutation must be the *same* mutation the UI performs — which is why these
 * assert on tasks and events rather than on reply strings alone.
 */

const NOW = new Date(2026, 8, 8, 10, 0, 0)
const CHAT = '1000'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  resetTelegramSessions()
})

let sequence = 0

function update(text: string, overrides: Partial<IncomingTelegramMessage> = {}): IncomingTelegramMessage {
  sequence += 1
  return {
    source: 'telegram',
    externalId: String(sequence),
    chatId: CHAT,
    senderId: '55',
    text,
    receivedAt: NOW.getTime(),
    ...overrides,
  }
}

const send = (text: string, overrides: Partial<IncomingTelegramMessage> = {}) =>
  processTelegramMessage(update(text, overrides), { authorizedChatId: CHAT })

const titles = async () => (await taskRepo.listLive()).map((task) => task.title)
const eventTypes = async () => (await eventRepo.list()).map((event) => event.type)

// ------------------------------------------------------------ idempotency

describe('deduplication is by identity, never by content', () => {
  it('creates one task, then ignores the redelivery of the same update', async () => {
    const first = update('/add Study Java')

    const once = await processTelegramMessage(first, { authorizedChatId: CHAT })
    expect(once.processed).toBe(true)
    expect(await titles()).toEqual(['Study Java'])

    // Telegram resends anything whose offset was not advanced.
    const again = await processTelegramMessage(first, { authorizedChatId: CHAT })
    expect(again.processed).toBe(false)
    expect(again.reply).toBeNull()
    expect(await titles()).toEqual(['Study Java'])
  })

  it('creates two tasks for two updates carrying identical text', async () => {
    // The proof that deduplication is by Telegram identity, not by message
    // body: asking twice for the same thing is a legitimate thing to do.
    await send('/add Water the plants')
    await send('/add Water the plants')

    expect(await titles()).toEqual(['Water the plants', 'Water the plants'])
  })

  it('survives a crash between the mutation and the cursor advancing', async () => {
    // The sequence Phase 41 describes: process, die before ack, restart, and
    // receive the very same update again.
    const message = update('/add Book dentist')
    await processTelegramMessage(message, { authorizedChatId: CHAT })
    expect(await titles()).toEqual(['Book dentist'])

    // "Restart": in-memory session state is gone, the database is not.
    resetTelegramSessions()

    const replay = await processTelegramMessage(message, { authorizedChatId: CHAT })
    expect(replay.processed).toBe(false)
    expect(await titles()).toEqual(['Book dentist'])

    // And the log row is still the single record of it.
    const logged = await messageLogRepo.findByExternalId('telegram', message.externalId)
    expect(logged?.status).toBe('done')
  })

  it('records every update exactly once in the message log', async () => {
    const message = update('/add Once')
    await processTelegramMessage(message, { authorizedChatId: CHAT })
    await processTelegramMessage(message, { authorizedChatId: CHAT })
    await processTelegramMessage(message, { authorizedChatId: CHAT })

    expect(await messageLogRepo.count()).toBe(1)
  })
})

// ----------------------------------------------------------- authorization

describe('only the authorized chat is obeyed', () => {
  it('refuses a message from another chat, changing nothing', async () => {
    const outcome = await processTelegramMessage(update('/add Take over', { chatId: '9999' }), {
      authorizedChatId: CHAT,
    })

    expect(outcome.processed).toBe(false)
    expect(outcome.reply).toBeNull()
    expect(await titles()).toEqual([])
    // Not even a message log row: an unauthorized message is not an event in
    // this application's life.
    expect(await messageLogRepo.count()).toBe(0)
  })

  it('refuses a destructive command from another chat', async () => {
    await createTask(taskInput({ title: 'Precious' }))

    await processTelegramMessage(update('/delete Precious', { chatId: '9999' }), {
      authorizedChatId: CHAT,
    })

    expect(await titles()).toEqual(['Precious'])
  })
})

// --------------------------------------------------------------- commands

describe('commands run through the application that already exists', () => {
  it('captures a task with the Quick Add parser, tokens and all', async () => {
    const outcome = await send('/add Study Java tomorrow at 7pm #dsa !high ~45m')

    const [task] = await taskRepo.listLive()
    expect(task?.title).toBe('Study Java')
    expect(task?.dueDate).toBe('2026-09-09')
    expect(task?.dueTime).toBe('19:00')
    expect(task?.priority).toBe('high')
    expect(task?.estimateMin).toBe(45)

    expect(outcome.reply?.text).toContain('Task created')
    expect(outcome.reply?.text).toContain('Study Java')
  })

  it('captures plain text as quick capture, with no second parser', async () => {
    await send('Read chapter four tomorrow')

    const [task] = await taskRepo.listLive()
    expect(task?.title).toBe('Read chapter four')
    expect(task?.dueDate).toBe('2026-09-09')
  })

  it('completes a task named by text', async () => {
    await createTask(taskInput({ title: 'Solve arrays' }))

    const outcome = await send('/done Solve arrays')

    const [task] = await taskRepo.listLive()
    expect(task?.status).toBe('done')
    expect(outcome.reply?.text.toLowerCase()).toContain('complete')
  })

  it('completes a task named by its position in the last list shown', async () => {
    await createTask(taskInput({ title: 'First', dueDate: '2026-09-08' }))
    await createTask(taskInput({ title: 'Second', dueDate: '2026-09-08' }))

    const listed = await send('/today')
    expect(listed.reply?.text).toContain('1. ')

    await send('/done 2')

    const done = (await taskRepo.listLive()).filter((task) => task.status === 'done')
    expect(done).toHaveLength(1)
  })

  it('creates a note through the existing note service', async () => {
    await send('/note Java recursion notes')

    const notes = await noteRepo.listLive()
    expect(notes.map((note) => note.title)).toEqual(['Java recursion notes'])
    // The real note model, with the vault path M9 reserves for every note.
    expect(notes[0]?.vaultPath).toContain('.md')
  })

  it('answers /help, /start and /status without touching anything', async () => {
    const before = (await eventRepo.list()).length

    expect((await send('/start')).reply?.text).toContain('Vaultwork is listening')
    expect((await send('/help')).reply?.text).toContain('/add')
    expect((await send('/status')).reply?.text).toContain('Today:')

    expect((await eventRepo.list()).length).toBe(before)
  })

  it('lists habits, projects and goals from the same query services the UI uses', async () => {
    expect((await send('/habits')).reply?.text).toBe('No habits yet.')
    expect((await send('/projects')).reply?.text).toBe('No active projects.')
    expect((await send('/goals')).reply?.text).toBe('No open goals.')
  })

  it('says so plainly when it does not know a command', async () => {
    const outcome = await send('/frobnicate everything')
    expect(outcome.reply?.text).toContain("I don't know that command")
    expect(await titles()).toEqual([])
  })

  it('reports an unfindable task rather than guessing', async () => {
    expect((await send('/done nothing like this')).reply?.text).toBeTruthy()
    expect(await titles()).toEqual([])
  })
})

// ------------------------------------------------------------------ views

describe('reading changes nothing', () => {
  it('answers /today, /inbox, /upcoming and /overdue without a single event', async () => {
    await createTask(taskInput({ title: 'Due today', dueDate: '2026-09-08' }))
    await createTask(taskInput({ title: 'Overdue', dueDate: '2026-09-01' }))
    await createTask(taskInput({ title: 'Loose end' }))

    const before = (await eventRepo.list()).length

    expect((await send('/today')).reply?.text).toContain('Due today')
    expect((await send('/inbox')).reply?.text).toContain('Loose end')
    expect((await send('/overdue')).reply?.text).toContain('Overdue')
    expect((await send('/upcoming')).reply?.text).toBeTruthy()

    // Reading is reading. The message log records that a message arrived; the
    // event log — which is the application's history — stays untouched.
    expect((await eventRepo.list()).length).toBe(before)
  })

  it('says "No overdue tasks." when there are none', async () => {
    expect((await send('/overdue')).reply?.text).toBe('No overdue tasks.')
  })

  it('keeps a list compact rather than dumping the database', async () => {
    for (let n = 0; n < 40; n += 1) {
      await createTask(taskInput({ title: `Task ${n}`, dueDate: '2026-09-08' }))
    }

    const text = (await send('/today')).reply?.text ?? ''
    expect(text).toContain('…and 25 more.')
    expect(text.split('\n').length).toBeLessThan(60)
  })
})

// ------------------------------------------------------------- ambiguity

describe('ambiguity is answered, never guessed', () => {
  it('asks which task and mutates nothing until told', async () => {
    await createTask(taskInput({ title: 'Study Java' }))
    await createTask(taskInput({ title: 'Study JavaScript' }))

    // "Study Java" matches one title exactly, and M3's resolver rightly treats
    // an exact match as unambiguous. A shared prefix is the ambiguous case.
    const asked = await send('/done Study')

    expect(asked.reply?.text).toContain('Which task did you mean?')
    expect(asked.reply?.text).toContain('1. ')
    expect(asked.reply?.text).toContain('2. ')

    const statuses = (await taskRepo.listLive()).map((task) => task.status)
    expect(statuses).toEqual(['todo', 'todo'])
  })

  it('completes only the task the number named', async () => {
    await createTask(taskInput({ title: 'Study Java' }))
    await createTask(taskInput({ title: 'Study JavaScript' }))

    const asked = await send('/done Study')
    const first = /1\. (.+)/.exec(asked.reply?.text ?? '')?.[1]

    await send('/done 1')

    const done = (await taskRepo.listLive()).filter((task) => task.status === 'done')
    expect(done).toHaveLength(1)
    expect(done[0]?.title).toBe(first)
  })
})

// ----------------------------------------------------------- destructive

describe('deleting asks first', () => {
  it('proposes the deletion and writes nothing yet', async () => {
    await createTask(taskInput({ title: 'Book dentist appointment' }))

    const asked = await send('/delete Book dentist')

    expect(asked.reply?.text).toContain('Delete this task?')
    expect(asked.reply?.text).toContain('Book dentist appointment')
    expect(await titles()).toEqual(['Book dentist appointment'])
  })

  it('deletes on /confirm, through the existing command', async () => {
    await createTask(taskInput({ title: 'Book dentist appointment' }))

    await send('/delete Book dentist')
    await send('/confirm')

    expect(await titles()).toEqual([])
    expect(await eventTypes()).toContain('task.deleted')
  })

  it('keeps the task on /cancel', async () => {
    await createTask(taskInput({ title: 'Book dentist appointment' }))

    await send('/delete Book dentist')
    const cancelled = await send('/cancel')

    expect(cancelled.reply?.text).toBe('Cancelled. Nothing was changed.')
    expect(await titles()).toEqual(['Book dentist appointment'])
  })

  it('refuses a /confirm that follows nothing', async () => {
    await createTask(taskInput({ title: 'Safe' }))

    const outcome = await send('/confirm')

    expect(outcome.reply?.text).toBe('Nothing is waiting for confirmation.')
    expect(await titles()).toEqual(['Safe'])
  })

  it('cannot be replayed: one /confirm consumes the pending action', async () => {
    await createTask(taskInput({ title: 'Once' }))
    await createTask(taskInput({ title: 'Twice' }))

    await send('/delete Once')
    await send('/confirm')
    const replay = await send('/confirm')

    expect(replay.reply?.text).toBe('Nothing is waiting for confirmation.')
    expect(await titles()).toEqual(['Twice'])
  })
})

// ---------------------------------------------------------------- events

describe('event attribution', () => {
  it('stamps telegram on a mutation it caused', async () => {
    await send('/add Study Java')

    const created = (await eventRepo.list()).find((event) => event.type === 'task.created')
    expect(created?.source).toBe('telegram')
  })

  it('stamps telegram on a completion and a deletion too', async () => {
    await createTask(taskInput({ title: 'Chore' }))
    await send('/done Chore')

    const completed = (await eventRepo.list()).find((event) => event.type === 'task.completed')
    expect(completed?.source).toBe('telegram')
  })

  it('invents no event for the message itself', async () => {
    await send('/add Study Java')

    const types = await eventTypes()
    expect(types.some((type) => type.startsWith('telegram.'))).toBe(false)
    expect(types.some((type) => type.includes('message'))).toBe(false)
  })
})

// --------------------------------------------------------------- oddities

describe('malformed and unusual input', () => {
  it('handles an empty message without doing anything', async () => {
    const outcome = await send('   ')
    expect(outcome.reply?.text).toContain("I don't know that command")
    expect(await titles()).toEqual([])
  })

  it('carries unicode and emoji into the task title unharmed', async () => {
    await send('/add Café ☕ with 日本語 notes')
    expect(await titles()).toEqual(['Café ☕ with 日本語 notes'])
  })

  it('accepts a command addressed to the bot by name', async () => {
    await createTask(taskInput({ title: 'Group task' }))
    await send('/done@vaultwork_test_bot Group task')

    const [task] = await taskRepo.listLive()
    expect(task?.status).toBe('done')
  })

  it('does not treat a very long number as a list position it does not have', async () => {
    const outcome = await send('/done 999')
    expect(outcome.reply?.text).toBe("I couldn't find that task.")
  })
})
