import { useCallback, useEffect, useState } from 'react'
import { platform } from '@/platform'

/**
 * Whether macOS opens Vaultwork after login.
 *
 * The value is read from the operating system on mount and again after every
 * change, never remembered locally. Removing the login item in System Settings
 * therefore shows up here, instead of leaving a checkbox asserting something
 * the OS stopped agreeing with.
 */
export interface LaunchAtLogin {
  /** False in the browser, where there is no login item. */
  supported: boolean
  enabled: boolean
  busy: boolean
  error: string | null
  set: (enabled: boolean) => Promise<void>
}

export function useLaunchAtLogin(): LaunchAtLogin {
  const supported = platform.desktop.isSupported
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supported) return
    let alive = true
    void platform.desktop
      .launchAtLogin()
      .then((value) => {
        if (alive) setEnabled(value)
      })
      // A login item that cannot be read is a Settings problem, not a reason to
      // reject and leave an unhandled rejection behind.
      .catch(() => {
        if (alive) setEnabled(false)
      })
    return () => {
      alive = false
    }
  }, [supported])

  const set = useCallback(async (next: boolean) => {
    setBusy(true)
    setError(null)
    try {
      // The OS decides. Whatever it reports is what the checkbox shows, so a
      // write that did not take cannot leave the control lying.
      setEnabled(await platform.desktop.setLaunchAtLogin(next))
    } catch (thrown) {
      setError(
        thrown instanceof Error && thrown.message.length > 0
          ? thrown.message
          : 'Could not change your login items.',
      )
    } finally {
      setBusy(false)
    }
  }, [])

  return { supported, enabled, busy, error, set }
}
