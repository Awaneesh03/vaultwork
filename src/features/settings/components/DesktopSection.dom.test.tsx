import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { platform } from '@/platform'
import { DesktopSection } from './DesktopSection'

/**
 * Launch at login.
 *
 * The property under test throughout is that the checkbox shows what the
 * *operating system* says, never what the user last clicked. A login item can
 * be removed in System Settings behind the app's back, and a control that
 * remembered its own value would then assert something untrue.
 */

const real = platform.desktop

afterEach(() => {
  Object.defineProperty(platform, 'desktop', { value: real, configurable: true })
  vi.restoreAllMocks()
})

function withDesktop(over: Partial<typeof real>) {
  Object.defineProperty(platform, 'desktop', {
    value: { ...real, isSupported: true, ...over },
    configurable: true,
  })
}

const checkbox = () => screen.getByRole('checkbox', { name: /Launch Vaultwork at login/ })

describe('launch at login', () => {
  it('reflects the state the OS reports, not a local default', async () => {
    withDesktop({ launchAtLogin: async () => true })
    render(<DesktopSection />)

    await waitFor(() => expect((checkbox() as HTMLInputElement).checked).toBe(true))
  })

  it('writes through the port and adopts whatever the OS ends up saying', async () => {
    const set = vi.fn(async () => true)
    withDesktop({ launchAtLogin: async () => false, setLaunchAtLogin: set })
    render(<DesktopSection />)

    await waitFor(() => expect((checkbox() as HTMLInputElement).checked).toBe(false))
    fireEvent.click(checkbox())

    await waitFor(() => expect(set).toHaveBeenCalledWith(true))
    await waitFor(() => expect((checkbox() as HTMLInputElement).checked).toBe(true))
  })

  it('shows the OS answer even when it disagrees with the request', async () => {
    // A write that reports success without taking effect must not leave the
    // checkbox claiming something the OS does not agree with.
    withDesktop({ launchAtLogin: async () => false, setLaunchAtLogin: async () => false })
    render(<DesktopSection />)

    await waitFor(() => expect(checkbox()).toBeTruthy())
    fireEvent.click(checkbox())

    await waitFor(() => expect((checkbox() as HTMLInputElement).checked).toBe(false))
  })

  it('reports a failure instead of silently doing nothing', async () => {
    withDesktop({
      launchAtLogin: async () => false,
      setLaunchAtLogin: async () => {
        throw new Error('Could not add Vaultwork to your login items.')
      },
    })
    render(<DesktopSection />)

    await waitFor(() => expect(checkbox()).toBeTruthy())
    fireEvent.click(checkbox())

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not add Vaultwork to your login items.',
    )
  })

  it('survives an unreadable login item rather than rejecting', async () => {
    withDesktop({
      launchAtLogin: async () => {
        throw new Error('unreadable')
      },
    })
    render(<DesktopSection />)

    // Settings must still paint; an unknown state reads as off.
    await waitFor(() => expect((checkbox() as HTMLInputElement).checked).toBe(false))
  })

  it('offers nothing at all in a browser build', () => {
    Object.defineProperty(platform, 'desktop', {
      value: { ...real, isSupported: false },
      configurable: true,
    })
    render(<DesktopSection />)

    // A checkbox that cannot do anything is worse than an explanation.
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText(/Login items are a desktop feature/)).toBeTruthy()
  })

  it('distinguishes itself from the Telegram setting in words', () => {
    // The two are routinely confused; the copy has to carry the difference.
    withDesktop({ launchAtLogin: async () => false })
    render(<DesktopSection />)

    expect(screen.getByText(/Start Telegram\s+automatically/)).toBeTruthy()
  })
})
