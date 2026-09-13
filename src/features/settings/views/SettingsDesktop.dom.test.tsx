import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { platform } from '@/platform'
import { eventRepo } from '@/repositories'
import { useUiStore } from '@/store/uiStore'
import { resetDatabase, freezeClock } from '../../../../tests/helpers'
import { SettingsView } from './SettingsView'

/**
 * The desktop-facing parts of Settings.
 *
 * Two claims to keep honest: the Test Notification button reports what actually
 * happened rather than always saying "sent", and File ▸ Export / File ▸ Import
 * from the native menu press the *same* controls a mouse would rather than a
 * second copy of them.
 */

const NOW = new Date(2026, 8, 7, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useUiStore.setState({ menuRequest: null })
})

const app = () =>
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsView />
    </MemoryRouter>,
  )

describe('the test notification', () => {
  it('sends one, with the message the milestone specifies', async () => {
    vi.spyOn(platform.notifications, 'isSupported', 'get').mockReturnValue(true)
    vi.spyOn(platform.notifications, 'permission').mockReturnValue('granted')
    const notify = vi.spyOn(platform.notifications, 'notify').mockResolvedValue()

    app()
    fireEvent.click(screen.getByRole('button', { name: 'Test notification' }))

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Vaultwork', 'Desktop notifications are working.')
    })
  })

  it('reports a refusal instead of claiming success', async () => {
    vi.spyOn(platform.notifications, 'isSupported', 'get').mockReturnValue(true)
    vi.spyOn(platform.notifications, 'permission').mockReturnValue('denied')

    app()
    fireEvent.click(screen.getByRole('button', { name: 'Test notification' }))

    expect(await screen.findByText(/blocked/i)).toBeTruthy()
  })

  it('writes no event — sending a notification is not a data mutation', async () => {
    vi.spyOn(platform.notifications, 'isSupported', 'get').mockReturnValue(true)
    vi.spyOn(platform.notifications, 'permission').mockReturnValue('granted')
    vi.spyOn(platform.notifications, 'notify').mockResolvedValue()

    const before = (await eventRepo.list()).length
    app()
    fireEvent.click(screen.getByRole('button', { name: 'Test notification' }))

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect((await eventRepo.list()).length).toBe(before)
  })
})

describe('the diagnostics panel', () => {
  it('reports the runtime, the database and whether storage is persisted', async () => {
    app()

    fireEvent.click(screen.getByText('Diagnostics'))

    expect(await screen.findByText('runtime')).toBeTruthy()
    expect(screen.getByText('database')).toBeTruthy()
    expect(screen.getByText('storage persisted')).toBeTruthy()
    expect(screen.getByText('vault adapter')).toBeTruthy()
  })

  it('is tucked away rather than cluttering the screen', () => {
    const { container } = app()

    // A <details> that starts closed: it answers a question you go looking for.
    const panel = container.querySelector('details')
    expect(panel).toBeTruthy()
    expect(panel?.open).toBe(false)
  })
})

describe('the native menu reaches the settings screen', () => {
  it('runs an export when File ▸ Export left a request', async () => {
    const write = vi.spyOn(platform.fileSystem, 'writeFile').mockResolvedValue()

    app()
    useUiStore.getState().requestMenuAction('export')

    // The same code path the Export JSON button uses — not a second one.
    await waitFor(() => expect(write).toHaveBeenCalled())
  })

  it('clears the request so it cannot fire twice', async () => {
    vi.spyOn(platform.fileSystem, 'writeFile').mockResolvedValue()

    app()
    useUiStore.getState().requestMenuAction('export')

    await waitFor(() => expect(useUiStore.getState().menuRequest).toBeNull())
  })

  it('opens the file picker when File ▸ Import left a request', async () => {
    const { container } = app()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const click = vi.spyOn(input, 'click')

    useUiStore.getState().requestMenuAction('import')

    await waitFor(() => expect(click).toHaveBeenCalled())
  })

  it('does nothing at all when no menu request is pending', async () => {
    const write = vi.spyOn(platform.fileSystem, 'writeFile').mockResolvedValue()

    app()
    await waitFor(() => expect(screen.getByText('Backup')).toBeTruthy())

    expect(write).not.toHaveBeenCalled()
  })
})

/**
 * M14's architectural requirement, pinned.
 *
 * Telegram is one section of Settings. Whatever it is doing — unconfigured,
 * stopped, erroring, or not answering at all — the rest of the screen must
 * still render and still work. The regression that motivated this was on the
 * native side (a status command that deadlocked the main thread), but the
 * renderer's own guarantee is worth holding independently: nothing here awaits
 * a Telegram answer before painting.
 */
describe('Telegram cannot hold Settings hostage', () => {
  const real = platform.telegram

  afterEach(() => {
    Object.defineProperty(platform, 'telegram', { value: real, configurable: true })
  })

  const withTelegram = (overrides: Partial<typeof real>) => {
    Object.defineProperty(platform, 'telegram', {
      value: { ...real, isSupported: true, ...overrides },
      configurable: true,
    })
  }

  it('renders every other section while the status call never answers', async () => {
    // The exact shape of the bug: a status that is pending forever.
    withTelegram({
      status: () => new Promise(() => {}),
      subscribeStatus: () => new Promise(() => {}),
    })

    app()

    // Settings reached "loaded", not a spinner, without a Telegram answer.
    expect(await screen.findByText('Appearance')).toBeTruthy()
    expect(screen.getByText('Backup')).toBeTruthy()
    expect(screen.getByText('Notifications')).toBeTruthy()
    expect(screen.getByText('Telegram')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()

    // And still usable: an unrelated control works.
    const write = vi.spyOn(platform.fileSystem, 'writeFile').mockResolvedValue()
    fireEvent.click(screen.getByRole('button', { name: /Export JSON/ }))
    await waitFor(() => expect(write).toHaveBeenCalled())
  })

  it('renders every other section when the status call rejects', async () => {
    withTelegram({
      status: () => Promise.reject(new Error('native side is unavailable')),
      subscribeStatus: () => Promise.reject(new Error('native side is unavailable')),
    })

    app()

    expect(await screen.findByText('Appearance')).toBeTruthy()
    expect(screen.getByText('Storage')).toBeTruthy()
    expect(screen.getByText('Telegram')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()
  })
})

/**
 * The Assistant section, which Settings was missing entirely.
 *
 * The route existed, the port existed, the native provider existed — and there
 * was no way to see or change any of it from Settings, so a configured
 * assistant looked identical to an absent one. These pin the section's
 * presence and, more importantly, that it never becomes a place a secret can
 * be read back out of.
 */
describe('the Assistant section', () => {
  const realAi = platform.ai

  afterEach(() => {
    Object.defineProperty(platform, 'ai', { value: realAi, configurable: true })
  })

  const withAi = (overrides: Partial<typeof realAi>) => {
    Object.defineProperty(platform, 'ai', {
      value: { ...realAi, isAvailable: true, ...overrides },
      configurable: true,
    })
  }

  const status = (over: Partial<Awaited<ReturnType<typeof realAi.status>>> = {}) => ({
    configured: false,
    enabled: false,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    lastError: null,
    keychainReads: 1,
    ...over,
  })

  it('appears in Settings at all', async () => {
    withAi({ status: async () => status() })
    app()

    expect(await screen.findByText('Assistant')).toBeTruthy()
  })

  it('says it is not configured, and offers a key field', async () => {
    withAi({ status: async () => status() })
    app()

    expect(await screen.findByText('Not configured')).toBeTruthy()
    expect(screen.getByLabelText('AI provider API key')).toBeTruthy()
  })

  it('distinguishes configured from enabled — the M15.1.1 default', async () => {
    // A saved key must not read as a working assistant. Off is the default and
    // the screen has to say so.
    withAi({ status: async () => status({ configured: true, enabled: false }) })
    app()

    expect(await screen.findByText('Configured · switched off')).toBeTruthy()
    const toggle = screen.getByLabelText(/reach the provider/i) as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })

  it('hands the key over and clears it from the form', async () => {
    const configure = vi.fn().mockResolvedValue(status({ configured: true }))
    withAi({ status: async () => status(), configure })
    app()

    const field = (await screen.findByLabelText('AI provider API key')) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'sk-test-secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: /Save key/ }))

    await waitFor(() => expect(configure).toHaveBeenCalledWith('sk-test-secret-value'))
    expect(field.value).toBe('')
  })

  it('keeps the key out of the DOM as readable text', async () => {
    withAi({ status: async () => status(), configure: vi.fn().mockResolvedValue(status()) })
    const { container } = app()

    const field = (await screen.findByLabelText('AI provider API key')) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'sk-test-secret-value' } })

    expect(field.type).toBe('password')
    expect(container.textContent).not.toContain('sk-test-secret-value')
  })

  it('says it is unsupported in a browser rather than offering a field', async () => {
    Object.defineProperty(platform, 'ai', {
      value: { ...realAi, isAvailable: false },
      configurable: true,
    })
    app()

    expect(await screen.findByText(/cannot hold a provider key/)).toBeTruthy()
    expect(screen.queryByLabelText('AI provider API key')).toBeNull()
  })

  it('does not hang Settings when the assistant status cannot be read', async () => {
    withAi({ status: () => Promise.reject(new Error('native side unavailable')) })
    app()

    // The rest of the screen still renders — the M14 lesson, held here too.
    expect(await screen.findByText('Appearance')).toBeTruthy()
    expect(screen.getByText('Assistant')).toBeTruthy()
  })
})
