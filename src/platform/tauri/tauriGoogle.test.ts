import { describe, expect, it } from 'vitest'
import { GoogleError, PortNotSupportedError } from '../ports'
import { createFakeTauriBridge } from './fakeBridge'
import { createTauriGoogle } from './tauriGoogle'

/**
 * The desktop Google adapters (M19.2), driven against the fake bridge in Node.
 *
 * The properties worth pinning: absence (not in the build, not connected, not
 * granted) reads as "not supported" rather than failure; a revoked grant
 * becomes "reconnect required"; all-day dates land on local midnight; and no
 * status, event or signal can carry a credential.
 */

const EVENTS = [
  {
    id: 'timed',
    title: 'Standup',
    start: { kind: 'at' as const, ms: new Date(2026, 8, 22, 9, 30).getTime() },
    end: { kind: 'at' as const, ms: new Date(2026, 8, 22, 10, 0).getTime() },
    all_day: false,
    status: 'confirmed',
  },
  {
    id: 'allday',
    title: 'Holiday',
    start: { kind: 'day' as const, date: '2026-09-24' },
    end: { kind: 'day' as const, date: '2026-09-25' },
    all_day: true,
    status: 'tentative',
  },
]

const SIGNALS = [
  {
    id: 'm1',
    subject: 'Offer letter',
    sender: 'HR Team',
    received_at: 1_790_035_200_000,
    important: true,
    snippet: '',
  },
]

const google = (options: Parameters<typeof createFakeTauriBridge>[0] = {}) => {
  const bridge = createFakeTauriBridge({ googleInBuild: true, ...options })
  return { bridge, ...createTauriGoogle(bridge) }
}

describe('status', () => {
  it('maps the native status and never carries a credential', async () => {
    const { google: port } = google({ googleGranted: { calendar: true, gmail: false } })
    const status = await port.status()
    expect(status).toMatchObject({
      configuredInBuild: true,
      authorized: true,
      calendar: true,
      gmail: false,
      account: 'you@example.com',
      reconnectRequired: false,
    })
    expect(Object.keys(status).sort()).toEqual([
      'account',
      'authorized',
      'calendar',
      'configuredInBuild',
      'connectedAt',
      'connecting',
      'gmail',
      'keychainReads',
      'lastCheckedAt',
      'lastError',
      'reconnectRequired',
    ])
  })

  it('never throws: an unreadable status is "not connected"', async () => {
    const { bridge, google: port } = google()
    bridge.failNext('googleStatus', { kind: 'network', message: 'boom' })
    expect(await port.status()).toMatchObject({ authorized: false, configuredInBuild: false })
  })

  it('reports a build without a Google client', async () => {
    const bridge = createFakeTauriBridge()
    const { google: port, calendar } = createTauriGoogle(bridge)
    expect((await port.status()).configuredInBuild).toBe(false)
    await expect(port.connect()).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(calendar.eventsBetween(0, 1)).rejects.toBeInstanceOf(PortNotSupportedError)
  })
})

describe('connecting', () => {
  it('connects, and shows exactly what was granted', async () => {
    const { bridge, google: port } = google({ googleConsent: { calendar: true, gmail: false } })
    const status = await port.connect()
    expect(status).toMatchObject({ authorized: true, calendar: true, gmail: false })
    expect(bridge.googleHasStoredGrant()).toBe(true)
  })

  it('turns a declined consent into a typed error, not a string', async () => {
    const { google: port } = google({ googleConsent: 'denied' })
    const error = await port.connect().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GoogleError)
    expect((error as GoogleError).kind).toBe('auth')
  })

  it('refuses a consent that granted nothing', async () => {
    const { google: port } = google({ googleConsent: { calendar: false, gmail: false } })
    await expect(port.connect()).rejects.toMatchObject({ kind: 'not-granted' })
  })

  it('falls back to a fixed sentence for an unknown native failure', async () => {
    const { bridge, google: port } = google()
    bridge.failNext('googleConnect', { kind: 'mystery', message: '' })
    await expect(port.connect()).rejects.toMatchObject({
      kind: 'auth',
      message: 'Google could not complete that request.',
    })
  })

  it('disconnects, and a reconnect restores the grant', async () => {
    const { bridge, google: port } = google({ googleGranted: { calendar: true, gmail: true } })
    expect((await port.disconnect()).authorized).toBe(false)
    expect(bridge.googleHasStoredGrant()).toBe(false)
    expect((await port.connect()).authorized).toBe(true)
  })
})

describe('the calendar port', () => {
  it('reads events, with all-day dates at local midnight', async () => {
    const { calendar } = google({
      googleGranted: { calendar: true, gmail: false },
      googleEvents: EVENTS,
    })
    const events = await calendar.eventsBetween(0, 1)
    expect(events).toEqual([
      {
        id: 'timed',
        title: 'Standup',
        start: new Date(2026, 8, 22, 9, 30).getTime(),
        end: new Date(2026, 8, 22, 10, 0).getTime(),
        allDay: false,
        status: 'confirmed',
      },
      {
        id: 'allday',
        title: 'Holiday',
        start: new Date(2026, 8, 24).getTime(),
        end: new Date(2026, 8, 25).getTime(),
        allDay: true,
        status: 'tentative',
      },
    ])
  })

  it('passes only the window across the bridge', async () => {
    const { bridge, calendar } = google({ googleGranted: { calendar: true, gmail: true } })
    await calendar.eventsBetween(100, 200)
    expect(bridge.googleReads).toEqual(['calendar 100..200'])
  })

  it('treats "not connected" and "not granted" as absence, not failure', async () => {
    const notConnected = google()
    await expect(notConnected.calendar.eventsBetween(0, 1)).rejects.toBeInstanceOf(
      PortNotSupportedError,
    )
    const gmailOnly = google({ googleGranted: { calendar: false, gmail: true } })
    await expect(gmailOnly.calendar.eventsBetween(0, 1)).rejects.toBeInstanceOf(
      PortNotSupportedError,
    )
  })

  it('reports a revoked grant as an auth failure, then as reconnect required', async () => {
    const {
      bridge,
      calendar,
      google: port,
    } = google({
      googleGranted: { calendar: true, gmail: true },
    })
    bridge.googleRevokeRemotely()
    const error = await calendar.eventsBetween(0, 1).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GoogleError)
    expect((error as GoogleError).kind).toBe('auth')
    expect(await port.status()).toMatchObject({ authorized: false, reconnectRequired: true })
  })
})

describe('the email port', () => {
  it('reads signals, with no body field anywhere', async () => {
    const { email } = google({
      googleGranted: { calendar: false, gmail: true },
      googleSignals: SIGNALS,
    })
    const signals = await email.recentSignals(8)
    expect(signals).toEqual([
      {
        id: 'm1',
        subject: 'Offer letter',
        sender: 'HR Team',
        receivedAt: 1_790_035_200_000,
        important: true,
        snippet: '',
      },
    ])
    expect(JSON.stringify(signals)).not.toMatch(/body|payload|token/i)
  })

  it('is absent when only the calendar was granted', async () => {
    const { email } = google({ googleGranted: { calendar: true, gmail: false } })
    await expect(email.recentSignals(8)).rejects.toBeInstanceOf(PortNotSupportedError)
  })

  it('reports a network failure as a failure', async () => {
    const { bridge, email } = google({ googleGranted: { calendar: true, gmail: true } })
    bridge.failNext('googleEmailSignals', {
      kind: 'network',
      message: 'Google could not be reached.',
    })
    await expect(email.recentSignals(8)).rejects.toMatchObject({ kind: 'network' })
  })
})
