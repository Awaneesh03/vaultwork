import { fromDateStr } from '@/lib/date'
import type { Timestamp } from '@/types/entities'
import {
  GoogleError,
  PortNotSupportedError,
  type CalendarEvent,
  type CalendarPort,
  type EmailPort,
  type EmailSignal,
  type GoogleErrorKind,
  type GooglePort,
  type GoogleStatus,
} from '../ports'
import type {
  BridgeCalendarEvent,
  BridgeEmailSignal,
  BridgeEventTime,
  BridgeGoogleStatus,
  TauriBridge,
} from './bridge'

/**
 * The desktop Google adapters (M19.2): one connection port, and the M19.1
 * calendar and email ports it serves.
 *
 * Thin on purpose, like `tauriAi`. Consent, tokens, hosts and Google's schema
 * all live in Rust; this translates DTOs into the ports' vocabulary. There is
 * no bridge command that returns a credential, so there is nothing here to
 * forget to leave out.
 *
 * One translation carries meaning. A read refused because Google is not in
 * this build, not connected, or not granted this service is *absence*, not
 * failure — so it becomes `PortNotSupportedError`, which Today shows as "not
 * connected" rather than "couldn't be read".
 */

const KINDS: ReadonlySet<string> = new Set<GoogleErrorKind>([
  'auth',
  'scope',
  'network',
  'timeout',
  'quota',
  'protocol',
  'unavailable',
  'not-connected',
  'not-granted',
  'cancelled',
  'busy',
  'keychain',
])

/** The kinds that mean "this source is not there", not "it failed". */
const ABSENT: ReadonlySet<GoogleErrorKind> = new Set([
  'unavailable',
  'not-connected',
  'not-granted',
])

function toGoogleError(error: unknown, fallback: GoogleErrorKind): GoogleError {
  if (error instanceof GoogleError) return error
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const raw = error as { kind: unknown; message?: unknown }
    const kind =
      typeof raw.kind === 'string' && KINDS.has(raw.kind) ? (raw.kind as GoogleErrorKind) : fallback
    const message =
      typeof raw.message === 'string' && raw.message.length > 0
        ? raw.message
        : 'Google could not complete that request.'
    return new GoogleError(kind, message)
  }
  // Never `String(error)`: an unexpected native failure is not display text.
  return new GoogleError(fallback, 'Google could not complete that request.')
}

const toStatus = (raw: BridgeGoogleStatus): GoogleStatus => ({
  configuredInBuild: raw.configured_in_build,
  authorized: raw.authorized,
  connecting: raw.connecting,
  reconnectRequired: raw.reconnect_required,
  calendar: raw.calendar,
  gmail: raw.gmail,
  account: raw.account,
  connectedAt: raw.connected_at,
  lastCheckedAt: raw.last_checked_at,
  lastError:
    raw.last_error !== null && KINDS.has(raw.last_error)
      ? (raw.last_error as GoogleErrorKind)
      : null,
  keychainReads: raw.keychain_reads,
})

/** The status used when one cannot be read at all: nothing connected. */
const UNKNOWN: GoogleStatus = {
  configuredInBuild: false,
  authorized: false,
  connecting: false,
  reconnectRequired: false,
  calendar: false,
  gmail: false,
  account: null,
  connectedAt: null,
  lastCheckedAt: null,
  lastError: null,
  keychainReads: 0,
}

/** An instant, or an all-day date at this device's local midnight. */
function toTimestamp(raw: BridgeEventTime | null): Timestamp | null {
  if (raw === null) return null
  if (raw.kind === 'at') return raw.ms
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? fromDateStr(raw.date).getTime() : null
}

/*
 * Field by field, into the port's shape. `boundEvents` and `boundSignals` in
 * the service validate and clip again — a second line, not the first.
 */
const toEvent = (raw: BridgeCalendarEvent) => ({
  id: raw.id,
  title: raw.title,
  start: toTimestamp(raw.start),
  end: toTimestamp(raw.end),
  allDay: raw.all_day,
  status: raw.status,
})

const toSignal = (raw: BridgeEmailSignal): EmailSignal => ({
  id: raw.id,
  subject: raw.subject,
  sender: raw.sender,
  receivedAt: raw.received_at,
  important: raw.important,
  snippet: raw.snippet,
})

export interface TauriGoogle {
  google: GooglePort
  calendar: CalendarPort
  email: EmailPort
}

export function createTauriGoogle(bridge: TauriBridge): TauriGoogle {
  const guard = async <T>(run: () => Promise<T>, fallback: GoogleErrorKind): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      throw toGoogleError(error, fallback)
    }
  }

  /** A read, with absence told apart from failure. */
  const read = async <T>(port: string, operation: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      const failure = toGoogleError(error, 'network')
      if (ABSENT.has(failure.kind)) throw new PortNotSupportedError(port, operation)
      throw failure
    }
  }

  const google: GooglePort = {
    id: 'google-tauri',
    isAvailable: true,
    async status() {
      try {
        return toStatus(await bridge.googleStatus())
      } catch {
        // Settings calls this on mount; a momentary failure is "not connected".
        return UNKNOWN
      }
    },
    connect: () => guard(async () => toStatus(await bridge.googleConnect()), 'auth'),
    cancelConnect: () => guard(async () => toStatus(await bridge.googleCancelConnect()), 'network'),
    disconnect: () => guard(async () => toStatus(await bridge.googleDisconnect()), 'keychain'),
  }

  const calendar: CalendarPort = {
    id: 'google-calendar',
    isSupported: true,
    eventsBetween: (from, to) =>
      read(
        'calendar',
        'eventsBetween',
        async () =>
          // An all-day date that fails to parse becomes a null start, which the
          // service's `boundEvents` drops; the cast is to its `unknown[]` input.
          (await bridge.googleCalendarEvents(from, to)).map(toEvent) as unknown as CalendarEvent[],
      ),
  }

  const email: EmailPort = {
    id: 'google-email',
    isSupported: true,
    recentSignals: (limit) =>
      read('email', 'recentSignals', async () =>
        (await bridge.googleEmailSignals(limit)).map(toSignal),
      ),
  }

  return { google, calendar, email }
}
