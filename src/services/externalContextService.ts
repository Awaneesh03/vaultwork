import { addDays, fromDateStr } from '@/lib/date'
import { platform, type CalendarEvent, type EmailSignal } from '@/platform'
import type { Timestamp } from '@/types/entities'

/**
 * External context for Today (M19.1): calendar and email, read-only.
 *
 * Kept apart from the Today context on purpose. `getTodayContext` is one live
 * query over Vaultwork's own tables; an external source is a network call that
 * can hang, fail or be absent, and folding it into that query would let a slow
 * mailbox blank the whole page — the Telegram-hostage bug M18.4 fixed, in a new
 * place. So each source is read on its own, and Today renders whatever arrives.
 *
 * In memory only. Nothing here is written to IndexedDB, the MCP snapshot,
 * Obsidian or a log: an external calendar or mailbox is not mirrored into a
 * local-first app, and a reload simply asks again.
 *
 * Every item an adapter returns is rebuilt field by field and bounded. If an
 * adapter ever handed back more than the port's shape — a message body, a
 * provider object — none of it survives this file.
 */

/** The ports' item shapes, so Today reads them without reaching the platform. */
export type { CalendarEvent, EmailSignal }

export const EXTERNAL_LIMITS = {
  /** How far ahead the calendar is read, from the start of today. */
  horizonDays: 7,
  events: 20,
  signals: 8,
  title: 200,
  sender: 120,
  snippet: 160,
} as const

export type ExternalState<T> =
  | { state: 'unavailable' }
  | { state: 'error'; checkedAt: Timestamp }
  | { state: 'ready'; items: T[]; fetchedAt: Timestamp; omitted: number }

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g

/** One line of text, bounded. Newlines and control characters become spaces. */
function line(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  return text.length === 0 ? null : text.slice(0, max)
}

const instant = (value: unknown): Timestamp | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

function statusOf(value: unknown): CalendarEvent['status'] | null {
  if (value === 'confirmed' || value === 'tentative') return value
  return null
}

/**
 * Calendar events, validated and bounded. Pure.
 *
 * Malformed entries are dropped rather than repaired: an event with no start
 * cannot be placed on a day, and a guessed one would be a meeting that is not
 * there. Earliest first, capped, with the overflow counted rather than hidden.
 */
export function boundEvents(raw: readonly unknown[]): {
  items: CalendarEvent[]
  omitted: number
} {
  const events: CalendarEvent[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const value = entry as Record<string, unknown>
    const id = line(value['id'], 200)
    const start = instant(value['start'])
    const end = instant(value['end'])
    const status = statusOf(value['status'])
    if (id === null || start === null || status === null) continue
    if (end !== null && end < start) continue
    events.push({
      id,
      title: line(value['title'], EXTERNAL_LIMITS.title) ?? 'Untitled event',
      start,
      end,
      allDay: value['allDay'] === true,
      status,
    })
  }
  events.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  return {
    items: events.slice(0, EXTERNAL_LIMITS.events),
    omitted: Math.max(0, events.length - EXTERNAL_LIMITS.events),
  }
}

/** Email signals, validated and bounded. Pure. There is no body to keep. */
export function boundSignals(raw: readonly unknown[]): {
  items: EmailSignal[]
  omitted: number
} {
  const signals: EmailSignal[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const value = entry as Record<string, unknown>
    const id = line(value['id'], 200)
    const receivedAt = instant(value['receivedAt'])
    if (id === null || receivedAt === null) continue
    signals.push({
      id,
      subject: line(value['subject'], EXTERNAL_LIMITS.title) ?? '(no subject)',
      sender: line(value['sender'], EXTERNAL_LIMITS.sender) ?? 'Unknown sender',
      receivedAt,
      important: value['important'] === true,
      snippet: line(value['snippet'], EXTERNAL_LIMITS.snippet) ?? '',
    })
  }
  signals.sort((a, b) => b.receivedAt - a.receivedAt || a.id.localeCompare(b.id))
  return {
    items: signals.slice(0, EXTERNAL_LIMITS.signals),
    omitted: Math.max(0, signals.length - EXTERNAL_LIMITS.signals),
  }
}

/**
 * The calendar from the start of today, a week ahead.
 *
 * `unavailable` when this build has no calendar connector — which, in M19.1,
 * is every build. `error` carries no provider text: an error message from a
 * remote API is exactly where a token or an address can leak.
 */
export async function readCalendar(): Promise<ExternalState<CalendarEvent>> {
  const port = platform.calendar
  if (!port.isSupported) return { state: 'unavailable' }
  const today = platform.clock.today()
  const from = fromDateStr(today).getTime()
  const to = fromDateStr(addDays(today, EXTERNAL_LIMITS.horizonDays)).getTime()
  try {
    const bounded = boundEvents(await port.eventsBetween(from, to))
    return { state: 'ready', ...bounded, fetchedAt: platform.clock.now() }
  } catch {
    return { state: 'error', checkedAt: platform.clock.now() }
  }
}

/** A few recent emails the provider marked important. Same rules as the calendar. */
export async function readEmail(): Promise<ExternalState<EmailSignal>> {
  const port = platform.email
  if (!port.isSupported) return { state: 'unavailable' }
  try {
    const bounded = boundSignals(await port.recentSignals(EXTERNAL_LIMITS.signals))
    return { state: 'ready', ...bounded, fetchedAt: platform.clock.now() }
  } catch {
    return { state: 'error', checkedAt: platform.clock.now() }
  }
}
