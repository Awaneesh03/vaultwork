import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platform } from '@/platform'
import { eventRepo, focusSessionRepo, settingsRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import {
  FocusAlreadyRunningError,
  cancelFocus,
  completeFocus,
  elapsedMinutes,
  focusEndsAt,
  getActiveFocus,
  isFocusExpired,
  listFocusHistory,
  plannedMinutesFor,
  remainingMs,
  startFocus,
} from './focusService'

/**
 * The Pomodoro timer against a real database.
 *
 * The property under test throughout is that a session is *timestamps*, not
 * ticks: what is stored is when it began and how long it meant to last, and
 * everything else — the countdown, the recorded duration, whether it has
 * expired — is arithmetic on those. That is what makes a reload mid-session,
 * and a laptop that slept, produce an honest answer rather than an invented
 * one, so the tests move the clock rather than waiting.
 */

// Thursday 3 September 2026, ten in the morning.
const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

/** Pins the clock to an exact instant, overriding `freezeClock`'s drift. */
function setNow(at: Date): void {
  vi.spyOn(platform.clock, 'now').mockReturnValue(at.getTime())
}

/**
 * The domain events, oldest first.
 *
 * The repository writes its own `focusSession.created` / `.updated` rows around
 * these; those are the storage layer's business and are filtered out here so
 * these assertions describe what the *feature* recorded.
 */
const focusEvents = async () =>
  (await eventRepo.list())
    .reverse()
    .map((event) => event.type)
    .filter((type) => type.startsWith('focus.'))

describe('starting a session', () => {
  it('takes its length from the pomodoro settings rather than a hardcoded number', async () => {
    await settingsRepo.update({
      pomodoro: { workMin: 40, shortBreakMin: 7, longBreakMin: 20, cyclesBeforeLongBreak: 3 },
    })

    expect(await plannedMinutesFor('work')).toBe(40)
    expect(await plannedMinutesFor('short_break')).toBe(7)
    expect(await plannedMinutesFor('long_break')).toBe(20)

    const session = await startFocus({ kind: 'short_break' })
    expect(session.plannedMin).toBe(7)
  })

  it('stores a running session with no end and records the start', async () => {
    const session = await startFocus()

    expect(session).toMatchObject({
      kind: 'work',
      plannedMin: 25,
      actualMin: 0,
      endedAt: null,
      taskId: null,
      projectId: null,
    })
    expect(await focusEvents()).toEqual(['focus.started'])
  })

  it('is the session getActiveFocus reports, and is not in the history yet', async () => {
    const session = await startFocus()

    expect(await getActiveFocus()).toMatchObject({ id: session.id })
    expect(await listFocusHistory()).toEqual([])
  })

  it('refuses a second session and hands back the one already running', async () => {
    const first = await startFocus()

    await expect(startFocus()).rejects.toBeInstanceOf(FocusAlreadyRunningError)
    await expect(startFocus()).rejects.toMatchObject({ session: { id: first.id } })

    // The refusal is the whole point: a double-click must not leave two clocks.
    expect(await focusSessionRepo.list()).toHaveLength(1)
    expect(await focusEvents()).toEqual(['focus.started'])
  })

  it('allows a new session once the previous one has ended', async () => {
    const first = await startFocus()
    await completeFocus(first.id)

    const second = await startFocus()
    expect(second.id).not.toBe(first.id)
    expect(await getActiveFocus()).toMatchObject({ id: second.id })
  })

  it('can be attached to a task', async () => {
    const session = await startFocus({ taskId: 'task-1', plannedMin: 15 })
    expect(session).toMatchObject({ taskId: 'task-1', plannedMin: 15 })
  })
})

describe('the countdown', () => {
  it('is derived from the session, so a reload cannot change it', async () => {
    const session = await startFocus({ plannedMin: 25 })

    const started = session.startedAt
    expect(focusEndsAt(session)).toBe(started + 25 * 60_000)
    expect(remainingMs(session, started)).toBe(25 * 60_000)
    expect(remainingMs(session, started + 10 * 60_000)).toBe(15 * 60_000)

    // Re-read from the database: the same arithmetic, the same answer.
    const reloaded = await focusSessionRepo.getOrThrow(session.id)
    expect(remainingMs(reloaded, started + 10 * 60_000)).toBe(15 * 60_000)
  })

  it('floors at zero rather than going negative when the machine was asleep', async () => {
    const session = await startFocus({ plannedMin: 25 })
    const hourLater = session.startedAt + 60 * 60_000

    expect(remainingMs(session, hourLater)).toBe(0)
    expect(isFocusExpired(session, hourLater)).toBe(true)
    expect(isFocusExpired(session, session.startedAt)).toBe(false)
  })

  it('never calls a finished session expired', async () => {
    const session = await startFocus({ plannedMin: 25 })
    const ended = await completeFocus(session.id)

    expect(isFocusExpired(ended, ended.startedAt + 60 * 60_000)).toBe(false)
  })
})

describe('finishing a session', () => {
  it('records the time actually spent, not the time planned', async () => {
    const session = await startFocus({ plannedMin: 25 })

    setNow(new Date(NOW.getTime() + 25 * 60_000))
    const done = await completeFocus(session.id)

    expect(done.outcome).toBe('completed')
    expect(done.endedAt).not.toBeNull()
    expect(done.actualMin).toBe(25)
    expect(await focusEvents()).toEqual(['focus.started', 'focus.completed'])
  })

  it('keeps the minutes already spent when a session is stopped early', async () => {
    const session = await startFocus({ plannedMin: 25 })

    setNow(new Date(NOW.getTime() + 12 * 60_000))
    const stopped = await cancelFocus(session.id)

    // Abandoning at minute twelve must not erase twelve minutes of work.
    expect(stopped.outcome).toBe('aborted')
    expect(stopped.actualMin).toBe(12)
    expect(await focusEvents()).toEqual(['focus.started', 'focus.cancelled'])
  })

  it('leaves nothing active and puts the session in the history', async () => {
    const session = await startFocus()
    setNow(new Date(NOW.getTime() + 5 * 60_000))
    await completeFocus(session.id)

    expect(await getActiveFocus()).toBeNull()
    expect(await listFocusHistory()).toMatchObject([{ id: session.id, actualMin: 5 }])
  })

  it('is a no-op the second time, so a tick and a click cannot both write', async () => {
    const session = await startFocus()
    setNow(new Date(NOW.getTime() + 9 * 60_000))
    const first = await completeFocus(session.id)

    setNow(new Date(NOW.getTime() + 30 * 60_000))
    const second = await completeFocus(session.id)
    const third = await cancelFocus(session.id)

    // The first ending stands; the later attempts change neither the duration
    // nor the outcome, and emit nothing.
    expect(second).toMatchObject({ endedAt: first.endedAt, actualMin: 9, outcome: 'completed' })
    expect(third).toMatchObject({ endedAt: first.endedAt, outcome: 'completed' })
    expect(await focusEvents()).toEqual(['focus.started', 'focus.completed'])
  })

  it('attributes the write to the source that asked for it', async () => {
    const session = await startFocus({}, { source: 'telegram' })
    await completeFocus(session.id, { source: 'telegram' })

    // Every row, the repository's included: a session started from Telegram
    // must not leave a log entry claiming someone clicked a button.
    const events = await eventRepo.list()
    expect(events).not.toHaveLength(0)
    expect(events.every((event) => event.source === 'telegram')).toBe(true)
  })
})

describe('the history', () => {
  it('is newest first and holds only finished sessions', async () => {
    const first = await startFocus()
    setNow(new Date(NOW.getTime() + 10 * 60_000))
    await completeFocus(first.id)

    const second = await startFocus()
    setNow(new Date(NOW.getTime() + 40 * 60_000))
    await cancelFocus(second.id)

    const third = await startFocus()

    const history = await listFocusHistory()
    expect(history.map((session) => session.id)).toEqual([second.id, first.id])
    expect(history.some((session) => session.id === third.id)).toBe(false)
  })

  it('stops at the limit it was given', async () => {
    for (let index = 0; index < 5; index += 1) {
      const session = await startFocus()
      setNow(new Date(NOW.getTime() + (index + 1) * 60_000))
      await completeFocus(session.id)
    }

    expect(await listFocusHistory(3)).toHaveLength(3)
    expect(await listFocusHistory()).toHaveLength(5)
  })
})

describe('elapsedMinutes', () => {
  it('rounds to whole minutes and never goes negative', () => {
    expect(elapsedMinutes(0, 0)).toBe(0)
    expect(elapsedMinutes(0, 29_000)).toBe(0)
    expect(elapsedMinutes(0, 31_000)).toBe(1)
    expect(elapsedMinutes(0, 25 * 60_000)).toBe(25)
    // A clock that went backwards is a clock problem, not negative focus time.
    expect(elapsedMinutes(60_000, 0)).toBe(0)
  })
})
