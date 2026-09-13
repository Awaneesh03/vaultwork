import { useCallback, useEffect, useMemo, useState } from 'react'
import { platform, TelegramError, type TelegramStatus } from '@/platform'

/**
 * The Telegram section's state.
 *
 * Everything here is a *reported* state rather than an inferred one: the status
 * comes from the native worker, and the worker pushes an update whenever
 * anything changes. Settings never decides it is connected because a token was
 * typed — "configured" and "running" are different fields for that reason.
 */

export type TelegramNotice = { ok: boolean; text: string } | null

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

/** The one sentence Settings shows at the top of the section. */
export function describeTelegram(status: TelegramStatus, supported: boolean): string {
  if (!supported) return 'Unsupported in this runtime'
  if (status.lastError !== null && !status.running) return 'Error'
  if (!status.configured) return 'Not configured'
  if (status.running && status.authorizedChatId !== null) return 'Running'
  if (status.running) return 'Running · waiting for authorization'
  if (status.authorizedChatId === null) return 'Configured · not authorized'
  return 'Stopped'
}

export function useTelegramSettings() {
  const supported = platform.telegram.isSupported
  const [status, setStatus] = useState<TelegramStatus>(IDLE)
  const [notice, setNotice] = useState<TelegramNotice>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await platform.telegram.status())
    } catch (error) {
      // A status that cannot be read is a Telegram problem, not a Settings
      // problem. It lands in the section's own error field and nothing else on
      // the screen notices. Letting it reject instead would leave an unhandled
      // rejection behind and strand the section on a stale status with no
      // explanation of why it stopped changing.
      setStatus((previous) => ({
        ...previous,
        lastError:
          error instanceof Error ? error.message : 'Could not read the Telegram status.',
      }))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The worker pushes: a chat writing in for the first time must appear in
  // Settings without the user thinking to reload it.
  useEffect(() => {
    if (!supported) return
    let unsubscribe: (() => void) | null = null
    let cancelled = false

    void platform.telegram
      .subscribeStatus(setStatus)
      .then((off) => {
        if (cancelled) off()
        else unsubscribe = off
      })
      .catch(() => {
        // Losing the push channel costs live updates, not the screen. The
        // status read on mount stands, and every action refreshes explicitly.
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [supported])

  const run = useCallback(
    async (label: string, action: () => Promise<TelegramStatus | string>) => {
      setBusy(true)
      setNotice(null)
      try {
        const result = await action()
        if (typeof result === 'string') setNotice({ ok: true, text: result })
        else setStatus(result)
        await refresh()
      } catch (error) {
        const text =
          error instanceof TelegramError
            ? error.message
            : error instanceof Error
              ? error.message
              : `${label} failed`
        setNotice({ ok: false, text })
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const actions = useMemo(
    () => ({
      /** The token goes straight to the OS credential store and is never returned. */
      configure: (token: string) =>
        run('Saving the token', async () => {
          const identity = await platform.telegram.configure(token)
          const name = identity.username === null ? 'the bot' : `@${identity.username}`
          return `Saved. Connected to ${name}.`
        }),
      test: () =>
        run('Testing', async () => {
          const identity = await platform.telegram.test()
          const name = identity.username === null ? 'the bot' : `@${identity.username}`
          return `Telegram bot connected — ${name}.`
        }),
      start: () => run('Starting', () => platform.telegram.start()),
      stop: () => run('Stopping', () => platform.telegram.stop()),
      authorize: (chatId: string) => run('Authorizing', () => platform.telegram.authorize(chatId)),
      disconnect: () => run('Disconnecting', () => platform.telegram.disconnect()),
      setAutoStart: (enabled: boolean) =>
        run('Saving', () => platform.telegram.setAutoStart(enabled)),
    }),
    [run],
  )

  return { supported, status, notice, busy, refresh, ...actions }
}
