import { useCallback, useEffect, useMemo, useState } from 'react'
import { GoogleError, platform, type GoogleStatus } from '@/platform'

/**
 * The Google section's state (M19.2).
 *
 * The same shape as `useAiSettings`, and the same rule: every value is what
 * the native side *reports*. "A grant is held" and "Google answered" are
 * separate facts, and nothing here ever holds a credential — connecting
 * happens in the user's browser, and no command returns a token.
 */

export type GoogleNotice = { ok: boolean; text: string } | null

const IDLE: GoogleStatus = {
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

/** The one line at the top of the section. */
export function describeGoogle(status: GoogleStatus, available: boolean): string {
  if (!available) return 'Desktop only'
  if (!status.configuredInBuild) return 'Not in this build'
  if (status.reconnectRequired) return 'Reconnect required'
  if (!status.authorized) return 'Not connected'
  if (status.lastError !== null) return 'Connected · last read failed'
  return 'Connected · read-only'
}

const messageOf = (error: unknown, fallback: string) =>
  error instanceof GoogleError || error instanceof Error ? error.message : fallback

const DAY_MS = 86_400_000

export function useGoogleSettings() {
  const available = platform.google.isAvailable
  const [status, setStatus] = useState<GoogleStatus>(IDLE)
  const [notice, setNotice] = useState<GoogleNotice>(null)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)

  const refresh = useCallback(async () => {
    // Never rejects: the adapter reports "not connected" when it cannot tell.
    setStatus(await platform.google.status())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async (label: string, action: () => Promise<string>) => {
      setBusy(true)
      setNotice(null)
      try {
        setNotice({ ok: true, text: await action() })
      } catch (error) {
        setNotice({ ok: false, text: messageOf(error, `${label} failed.`) })
      } finally {
        await refresh()
        setBusy(false)
      }
    },
    [refresh],
  )

  const actions = useMemo(
    () => ({
      /** Opens Google's consent page in the browser and waits for it. */
      connect: async () => {
        setWaiting(true)
        setNotice(null)
        try {
          await platform.google.connect()
          setNotice({ ok: true, text: 'Connected. Vaultwork can now read what you allowed.' })
        } catch (error) {
          const cancelled = error instanceof GoogleError && error.kind === 'cancelled'
          setNotice(
            cancelled
              ? { ok: true, text: 'Cancelled. Nothing was connected.' }
              : { ok: false, text: messageOf(error, 'Connecting to Google failed.') },
          )
        } finally {
          setWaiting(false)
          await refresh()
        }
      },
      cancel: () => void platform.google.cancelConnect().catch(() => undefined),
      /** One small read per granted service, so the status reflects Google now. */
      check: () =>
        run('Checking', async () => {
          const current = await platform.google.status()
          const now = platform.clock.now()
          if (current.calendar) await platform.calendar.eventsBetween(now, now + DAY_MS)
          if (current.gmail) await platform.email.recentSignals(1)
          return 'Google answered just now.'
        }),
      disconnect: () =>
        run('Disconnecting', async () => {
          await platform.google.disconnect()
          return 'Disconnected. The grant was removed from this Mac and revoked with Google.'
        }),
    }),
    [run, refresh],
  )

  return { available, status, notice, busy: busy || waiting, waiting, refresh, ...actions }
}
