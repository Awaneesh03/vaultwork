import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GoogleError, platform, type GooglePort, type GoogleStatus } from '@/platform'
import { GoogleSection } from './GoogleSection'

/**
 * The Google section of Settings (M19.2).
 *
 * Pinned: each state says what it is — not in this build, not connected,
 * waiting for the browser, connected with exactly what was granted, reconnect
 * required — and nothing on the screen can ever be a credential.
 */

const OFF: GoogleStatus = {
  configuredInBuild: true,
  authorized: false,
  connecting: false,
  reconnectRequired: false,
  calendar: false,
  gmail: false,
  account: null,
  connectedAt: null,
  lastCheckedAt: null,
  lastError: null,
  keychainReads: 1,
}

const CONNECTED: GoogleStatus = {
  ...OFF,
  authorized: true,
  calendar: true,
  gmail: true,
  account: 'you@example.com',
  connectedAt: 1,
  lastCheckedAt: new Date(2026, 8, 22, 10, 41).getTime(),
}

const real = { google: platform.google, calendar: platform.calendar, email: platform.email }

afterEach(() => {
  for (const [key, value] of Object.entries(real)) {
    Object.defineProperty(platform, key, { value, configurable: true, writable: true })
  }
})

function install(initial: GoogleStatus, overrides: Partial<GooglePort> = {}) {
  let current = initial
  const port: GooglePort = {
    id: 'google-fake',
    isAvailable: true,
    status: async () => current,
    connect: async () => (current = CONNECTED),
    cancelConnect: async () => current,
    disconnect: async () => (current = OFF),
    ...overrides,
  }
  Object.defineProperty(platform, 'google', { value: port, configurable: true, writable: true })
}

describe('the Google section', () => {
  it('says so when this build has no Google client', async () => {
    install({ ...OFF, configuredInBuild: false })
    render(<GoogleSection />)
    expect(await screen.findByText('Not in this build.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect Google' })).toBeNull()
  })

  it('offers to connect, and says it is read-only', async () => {
    install(OFF)
    render(<GoogleSection />)
    expect(await screen.findByRole('button', { name: 'Connect Google' })).toBeTruthy()
    expect(screen.getByText(/Read-only\..*never a message body/)).toBeTruthy()
  })

  it('waits for the browser, can be cancelled, and says nothing was connected', async () => {
    let reject: (error: unknown) => void = () => {}
    let cancelled = false
    install(OFF, {
      connect: () => new Promise((_, fail) => (reject = fail)),
      cancelConnect: async () => {
        cancelled = true
        reject(new GoogleError('cancelled', 'Connecting to Google was cancelled.'))
        return OFF
      },
    })
    render(<GoogleSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Google' }))
    expect(await screen.findByText('Waiting for your browser…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Cancelled. Nothing was connected.')).toBeTruthy()
    expect(cancelled).toBe(true)
  })

  it('shows the account and each service once connected', async () => {
    install(OFF)
    render(<GoogleSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Google' }))
    expect(await screen.findByText('you@example.com')).toBeTruthy()
    expect(screen.getAllByText('Connected · read-only').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('10:41 am')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
  })

  it('says plainly when only one service was granted, and offers to grant the other', async () => {
    install({ ...CONNECTED, gmail: false })
    render(<GoogleSection />)
    expect(await screen.findByText('Not granted')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reconnect to grant Gmail' })).toBeTruthy()
  })

  it('asks for a reconnect after Google refuses the grant', async () => {
    install({ ...OFF, reconnectRequired: true, lastError: 'auth' })
    render(<GoogleSection />)
    expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeTruthy()
    expect(screen.getByText(/no longer accepts this connection/)).toBeTruthy()
  })

  it('checks again with one small read per granted service', async () => {
    const reads: string[] = []
    install(CONNECTED)
    Object.defineProperty(platform, 'calendar', {
      value: {
        id: 'c',
        isSupported: true,
        eventsBetween: async () => {
          reads.push('calendar')
          return []
        },
      },
      configurable: true,
      writable: true,
    })
    Object.defineProperty(platform, 'email', {
      value: {
        id: 'e',
        isSupported: true,
        recentSignals: async () => {
          reads.push('email')
          return []
        },
      },
      configurable: true,
      writable: true,
    })
    render(<GoogleSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Google answered just now.')).toBeTruthy()
    expect(reads).toEqual(['calendar', 'email'])
  })

  it('confirms before disconnecting, then shows the connect button again', async () => {
    install(CONNECTED)
    render(<GoogleSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(screen.getByText('Disconnect Google?')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: 'Disconnect' })
    const confirm = buttons[buttons.length - 1]
    if (!confirm) throw new Error('no confirm button')
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Google' })).toBeTruthy())
  })

  it('never renders anything that could be a credential', async () => {
    install(CONNECTED)
    const { container } = render(<GoogleSection />)
    await screen.findByText('you@example.com')
    expect(container.textContent).not.toMatch(/token|secret|client|scope|googleapis|ya29|1\/\//i)
  })
})
