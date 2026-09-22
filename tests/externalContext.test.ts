import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { platform, type CalendarPort, type EmailPort } from '@/platform'
import {
  EXTERNAL_LIMITS,
  boundEvents,
  boundSignals,
  buildMcpSnapshot,
  getSources,
  getTodayContext,
  readCalendar,
  readEmail,
} from '@/services'
import { createTask } from '@/services/taskService'
import { SOURCE_IDS } from '@/types/enums'
import { taskInput } from './factories'
import { freezeClock, resetDatabase } from './helpers'

/**
 * M19.1: calendar and email context, read-only and in memory.
 *
 * No build has a real connector yet, so the ports are exercised through fake
 * adapters installed on `platform` — the same seam a native one would use.
 */

const NOW = new Date(2026, 8, 21, 10, 0, 0)
const at = (hour: number, day = 21) => new Date(2026, 8, day, hour, 0, 0).getTime()

const browser = { calendar: platform.calendar, email: platform.email }

function install<K extends 'calendar' | 'email'>(key: K, port: (typeof platform)[K]) {
  Object.defineProperty(platform, key, { value: port, configurable: true, writable: true })
}

const calendarOf = (eventsBetween: CalendarPort['eventsBetween']): CalendarPort => ({
  id: 'fake-calendar',
  isSupported: true,
  eventsBetween,
})

const emailOf = (recentSignals: EmailPort['recentSignals']): EmailPort => ({
  id: 'fake-email',
  isSupported: true,
  recentSignals,
})

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

afterEach(() => {
  install('calendar', browser.calendar)
  install('email', browser.email)
})

describe('bounding calendar events', () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    id: 'e1',
    title: 'Standup',
    start: at(9),
    end: at(10),
    allDay: false,
    status: 'confirmed',
    ...overrides,
  })

  it('keeps only the port’s fields — a provider object leaves nothing else behind', () => {
    const { items } = boundEvents([
      event({ description: 'secret agenda', attendees: ['a@b.c'], htmlLink: 'https://x' }),
    ])
    expect(items).toEqual([
      { id: 'e1', title: 'Standup', start: at(9), end: at(10), allDay: false, status: 'confirmed' },
    ])
  })

  it('drops what cannot be placed rather than guessing', () => {
    const { items } = boundEvents([
      null,
      'text',
      event({ id: '' }),
      event({ id: 'no-start', start: undefined }),
      event({ id: 'nan', start: Number.NaN }),
      event({ id: 'cancelled', status: 'cancelled' }),
      event({ id: 'backwards', start: at(11), end: at(10) }),
      event({ id: 'ok' }),
    ])
    expect(items.map((item) => item.id)).toEqual(['ok'])
  })

  it('clips titles to one bounded line and names an untitled event plainly', () => {
    const { items } = boundEvents([
      event({ id: 'a', title: `Line one\nline two\u0007${'x'.repeat(500)}` }),
      event({ id: 'b', title: '   ' }),
    ])
    expect(items[0]?.title.length).toBe(EXTERNAL_LIMITS.title)
    expect(items[0]?.title.includes('\n') || items[0]?.title.includes('\u0007')).toBe(false)
    expect(items[0]?.title.startsWith('Line one line two')).toBe(true)
    expect(items[1]?.title).toBe('Untitled event')
  })

  it('sorts earliest first, caps the list and counts the rest', () => {
    const many = Array.from({ length: EXTERNAL_LIMITS.events + 5 }, (_, i) =>
      event({ id: `e${i}`, start: at(8) + (30 - i) * 60_000, end: null }),
    )
    const { items, omitted } = boundEvents(many)
    expect(items).toHaveLength(EXTERNAL_LIMITS.events)
    expect(omitted).toBe(5)
    const starts = items.map((item) => item.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
})

describe('bounding email signals', () => {
  const signal = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    subject: 'Offer letter',
    sender: 'HR',
    receivedAt: at(8),
    important: true,
    snippet: 'Please sign',
    ...overrides,
  })

  it('never carries a body, headers or anything beyond the port’s shape', () => {
    const { items } = boundSignals([
      signal({ body: 'full message text', headers: { to: 'me' }, threadId: 't' }),
    ])
    expect(items).toEqual([
      {
        id: 'm1',
        subject: 'Offer letter',
        sender: 'HR',
        receivedAt: at(8),
        important: true,
        snippet: 'Please sign',
      },
    ])
  })

  it('bounds subject, sender and snippet, and drops undated entries', () => {
    const { items } = boundSignals([
      signal({ subject: 's'.repeat(999), sender: 'n'.repeat(999), snippet: 'p'.repeat(999) }),
      signal({ id: 'undated', receivedAt: 'yesterday' }),
      signal({ id: 'bare', receivedAt: at(7), subject: null, sender: 3, snippet: undefined }),
    ])
    expect(items.map((item) => item.id)).toEqual(['m1', 'bare'])
    expect(items[0]?.subject.length).toBe(EXTERNAL_LIMITS.title)
    expect(items[0]?.sender.length).toBe(EXTERNAL_LIMITS.sender)
    expect(items[0]?.snippet.length).toBe(EXTERNAL_LIMITS.snippet)
    expect(items[1]).toMatchObject({
      subject: '(no subject)',
      sender: 'Unknown sender',
      snippet: '',
    })
  })

  it('puts the newest first and caps the list', () => {
    const many = Array.from({ length: EXTERNAL_LIMITS.signals + 3 }, (_, i) =>
      signal({ id: `m${i}`, receivedAt: at(8) + i }),
    )
    const { items, omitted } = boundSignals(many)
    expect(items[0]?.id).toBe(`m${EXTERNAL_LIMITS.signals + 2}`)
    expect(items).toHaveLength(EXTERNAL_LIMITS.signals)
    expect(omitted).toBe(3)
  })
})

describe('reading the calendar', () => {
  it('is unavailable in this build, and asks nothing', async () => {
    expect(platform.calendar.isSupported).toBe(false)
    expect(await readCalendar()).toEqual({ state: 'unavailable' })
  })

  it('asks for today through a week ahead, from local midnight', async () => {
    const asked: [number, number][] = []
    install(
      'calendar',
      calendarOf(async (from, to) => {
        asked.push([from, to])
        return []
      }),
    )
    await readCalendar()
    expect(asked).toEqual([[at(0), at(0, 21 + EXTERNAL_LIMITS.horizonDays)]])
  })

  it('returns bounded events when the source answers', async () => {
    install(
      'calendar',
      calendarOf(async () => [
        { id: 'b', title: 'Lab', start: at(14), end: null, allDay: false, status: 'confirmed' },
        { id: 'a', title: 'Standup', start: at(9), end: null, allDay: false, status: 'tentative' },
      ]),
    )
    const state = await readCalendar()
    expect(state.state).toBe('ready')
    if (state.state !== 'ready') return
    expect(state.items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(state.omitted).toBe(0)
  })

  it('reports an error without the provider’s words — they are where a token leaks', async () => {
    install(
      'calendar',
      calendarOf(async () => {
        throw new Error('401 invalid_grant refresh_token=ya29.SECRET')
      }),
    )
    // Exactly a state and a time: no field exists to carry the provider's text.
    expect(await readCalendar()).toEqual({ state: 'error', checkedAt: expect.any(Number) })
  })
})

describe('reading email', () => {
  it('is unavailable in this build', async () => {
    expect(platform.email.isSupported).toBe(false)
    expect(await readEmail()).toEqual({ state: 'unavailable' })
  })

  it('asks for no more than it will show', async () => {
    const limits: number[] = []
    install(
      'email',
      emailOf(async (limit) => {
        limits.push(limit)
        return []
      }),
    )
    expect((await readEmail()).state).toBe('ready')
    expect(limits).toEqual([EXTERNAL_LIMITS.signals])
  })

  it('reports an error without the provider’s words', async () => {
    install(
      'email',
      emailOf(async () => {
        throw new Error('Bearer SECRET-TOKEN rejected')
      }),
    )
    expect(await readEmail()).toEqual({ state: 'error', checkedAt: expect.any(Number) })
  })
})

describe('what external context never touches', () => {
  const connected = () => {
    install(
      'calendar',
      calendarOf(async () => [
        {
          id: 'e',
          title: 'Interview',
          start: at(15),
          end: null,
          allDay: false,
          status: 'confirmed',
        },
      ]),
    )
    install(
      'email',
      emailOf(async () => [
        {
          id: 'm',
          subject: 'Offer',
          sender: 'HR',
          receivedAt: at(8),
          important: true,
          snippet: '',
        },
      ]),
    )
  }

  it('writes nothing to the database', async () => {
    await createTask(taskInput({ title: 'Mine', dueDate: '2026-09-21' }))
    connected()
    const before = await Promise.all(db.tables.map((table) => table.count()))
    await readCalendar()
    await readEmail()
    const after = await Promise.all(db.tables.map((table) => table.count()))
    expect(after).toEqual(before)
  })

  it('leaves the Today context built from Vaultwork alone', async () => {
    connected()
    const task = await createTask(taskInput({ title: 'Mine', dueDate: '2026-09-21' }))
    const day = await getTodayContext()
    expect(day.planned.map((entry) => entry.id)).toEqual([task.id])
    expect(day.sources).toMatchObject({ calendar: 'notConnected', email: 'notConnected' })
    expect(JSON.stringify([...day.reasons.values()])).not.toMatch(/Interview|Offer/)
  })

  it('never reaches the MCP snapshot', async () => {
    connected()
    await readCalendar()
    await readEmail()
    const snapshot = JSON.stringify(await buildMcpSnapshot())
    expect(snapshot).not.toMatch(/Interview|Offer/)
  })

  it('adds no source to the registry — nothing is connected to describe', async () => {
    connected()
    const ids = (await getSources()).map((source) => source.id)
    expect(ids).toEqual([...SOURCE_IDS])
    expect(ids).not.toContain('calendar')
    expect(ids).not.toContain('email')
  })
})
