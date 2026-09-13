import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { platform, TelegramError, type TelegramPort, type TelegramStatus } from '@/platform'
import { resetDatabase } from '../../../../tests/helpers'
import { TelegramSection } from './TelegramSection'

/**
 * The Telegram section of Settings.
 *
 * The properties worth pinning: the token never comes back onto the screen, the
 * badge distinguishes "configured" from "running", a chat is approved by an
 * explicit click and never automatically, and disconnecting asks first.
 */

const IDLE: TelegramStatus = {
  configured: false,
  running: false,
  botUsername: null,
  authorizedChatId: null,
  pendingChatId: null,
  pendingChatName: null,
  autoStart: false,
  lastError: null,
  keychainReads: 0,
}

const real = platform.telegram

function install(
  overrides: Partial<TelegramPort>,
  initial: TelegramStatus = IDLE,
): {
  port: TelegramPort
  push: (status: TelegramStatus) => void
} {
  let current = initial
  const listeners = new Set<(status: TelegramStatus) => void>()

  const port: TelegramPort = {
    id: 'telegram-fake',
    isSupported: true,
    async status() {
      return current
    },
    configure: async () => ({ id: 1, username: 'vaultwork_bot', firstName: 'Vaultwork' }),
    test: async () => ({ id: 1, username: 'vaultwork_bot', firstName: 'Vaultwork' }),
    start: async () => current,
    stop: async () => current,
    authorize: async () => current,
    disconnect: async () => current,
    setAutoStart: async () => current,
    sendMessage: async () => {},
    ack: async () => {},
    async subscribe() {
      return () => {}
    },
    async subscribeStatus(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    ...overrides,
  }

  Object.defineProperty(platform, 'telegram', { value: port, configurable: true, writable: true })
  return {
    port,
    push: (status) => {
      current = status
      for (const listener of listeners) listener(status)
    },
  }
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(() => {
  Object.defineProperty(platform, 'telegram', { value: real, configurable: true, writable: true })
})

describe('before a token exists', () => {
  it('says it is not configured and offers the token field', async () => {
    install({})
    render(<TelegramSection />)

    expect(await screen.findByText('Not configured')).toBeTruthy()
    expect(screen.getByLabelText('Telegram bot token')).toBeTruthy()
  })

  it('keeps the token out of the DOM as readable text', async () => {
    install({})
    const { container } = render(<TelegramSection />)

    const field = (await screen.findByLabelText('Telegram bot token')) as HTMLInputElement
    // A password field, so a shoulder or a screenshot does not capture it.
    expect(field.type).toBe('password')
    expect(container.innerHTML).not.toContain('123456:')
  })

  it('hands the token over and clears it from the form', async () => {
    const configure = vi
      .fn()
      .mockResolvedValue({ id: 1, username: 'vaultwork_bot', firstName: 'Vaultwork' })
    install({ configure })
    render(<TelegramSection />)

    const field = (await screen.findByLabelText('Telegram bot token')) as HTMLInputElement
    fireEvent.change(field, { target: { value: '123456:secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))

    await waitFor(() => expect(configure).toHaveBeenCalledWith('123456:secret'))
    // Not left sitting in a controlled input for the rest of the session.
    expect(field.value).toBe('')
  })

  it('reports an invalid token without revealing it', async () => {
    install({
      configure: async () => {
        throw new TelegramError('invalid-token', 'Telegram rejected the bot token.')
      },
    })
    render(<TelegramSection />)

    const field = await screen.findByLabelText('Telegram bot token')
    fireEvent.change(field, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain('rejected')
    expect(notice.textContent).not.toContain('wrong')
  })
})

describe('configured, but not running', () => {
  const configured: TelegramStatus = { ...IDLE, configured: true, botUsername: 'vaultwork_bot' }

  it('does not claim to be connected just because a token exists', async () => {
    install({}, configured)
    render(<TelegramSection />)

    expect(await screen.findByText('Configured · not authorized')).toBeTruthy()
    expect(screen.queryByText('Running')).toBeNull()
  })

  it('shows the bot identity rather than the token', async () => {
    install({}, configured)
    render(<TelegramSection />)

    expect(await screen.findByText('@vaultwork_bot')).toBeTruthy()
    expect(screen.queryByLabelText('Telegram bot token')).toBeNull()
  })

  it('offers Start, Test connection and Disconnect', async () => {
    install({}, configured)
    render(<TelegramSection />)

    expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()
  })

  it('defaults auto-start to off', async () => {
    install({}, configured)
    render(<TelegramSection />)

    const toggle = (await screen.findByRole('checkbox')) as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })
})

describe('authorization is explicit', () => {
  const pending: TelegramStatus = {
    ...IDLE,
    configured: true,
    running: true,
    botUsername: 'vaultwork_bot',
    pendingChatId: '1000',
    pendingChatName: 'Awaneesh',
  }

  it('shows a waiting chat and does not authorize it on its own', async () => {
    const authorize = vi.fn().mockResolvedValue(pending)
    install({ authorize }, pending)
    render(<TelegramSection />)

    expect(await screen.findByText('Awaneesh is asking for access.')).toBeTruthy()
    expect(authorize).not.toHaveBeenCalled()
  })

  it('authorizes only when the user clicks', async () => {
    const authorize = vi.fn().mockResolvedValue({ ...pending, authorizedChatId: '1000' })
    install({ authorize }, pending)
    render(<TelegramSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Authorize this chat' }))
    await waitFor(() => expect(authorize).toHaveBeenCalledWith('1000'))
  })

  it('warns what approving a chat grants', async () => {
    install({}, pending)
    render(<TelegramSection />)

    expect(await screen.findByText(/create, complete and delete your tasks/)).toBeTruthy()
  })
})

describe('running', () => {
  const running: TelegramStatus = {
    ...IDLE,
    configured: true,
    running: true,
    botUsername: 'vaultwork_bot',
    authorizedChatId: '1000',
  }

  it('says Running and offers Stop', async () => {
    install({}, running)
    render(<TelegramSection />)

    expect(await screen.findByText('Running')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('follows a status the worker pushes, without a reload', async () => {
    const { push } = install({}, running)
    render(<TelegramSection />)

    await screen.findByText('Running')
    push({ ...running, running: false })

    expect(await screen.findByText('Stopped')).toBeTruthy()
  })

  it('shows an error the worker reported', async () => {
    install({}, { ...running, running: false, lastError: 'Telegram is unreachable.' })
    render(<TelegramSection />)

    expect(await screen.findByText('Telegram is unreachable.')).toBeTruthy()
    expect(await screen.findByText('Error')).toBeTruthy()
  })
})

describe('disconnecting asks first', () => {
  const configured: TelegramStatus = { ...IDLE, configured: true, botUsername: 'vaultwork_bot' }

  it('does not disconnect on the first click', async () => {
    const disconnect = vi.fn().mockResolvedValue(IDLE)
    install({ disconnect }, configured)
    render(<TelegramSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))

    expect(await screen.findByText('Remove the bot token?')).toBeTruthy()
    expect(disconnect).not.toHaveBeenCalled()
  })

  it('promises that application data is untouched', async () => {
    install({}, configured)
    render(<TelegramSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByText(/tasks, notes, projects, goals, habits/)).toBeTruthy()
  })

  it('cancels cleanly', async () => {
    const disconnect = vi.fn().mockResolvedValue(IDLE)
    install({ disconnect }, configured)
    render(<TelegramSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText('Remove the bot token?')).toBeNull())
    expect(disconnect).not.toHaveBeenCalled()
  })
})

describe('in a browser', () => {
  it('says it is unsupported instead of pretending', async () => {
    Object.defineProperty(platform, 'telegram', {
      value: { ...real, isSupported: false },
      configurable: true,
      writable: true,
    })

    render(<TelegramSection />)
    expect(await screen.findByText('Unsupported in this runtime.')).toBeTruthy()
    expect(screen.queryByLabelText('Telegram bot token')).toBeNull()
  })
})
