import { useCallback, useEffect, useMemo, useState } from 'react'
import { AiError, platform, type AiStatus } from '@/platform'

/**
 * The Assistant section's state.
 *
 * The same shape — and the same reasoning — as `useTelegramSettings`. Every
 * value here is *reported* by the native side rather than inferred: "a key is
 * saved" and "the assistant is switched on" are separate fields because they
 * are separate facts, and a screen that conflated them would tell the user the
 * assistant was ready when it was merely configured.
 *
 * The credential itself never appears in this file. It is handed to
 * `platform.ai.configure` on its way to the OS keychain and is never returned
 * by anything — there is no command that reads it back, so there is nothing
 * here to forget to leave out.
 */

export type AiNotice = { ok: boolean; text: string } | null

const IDLE: AiStatus = {
  configured: false,
  enabled: false,
  provider: 'none',
  model: '',
  lastError: null,
  keychainReads: 0,
}

/** The one sentence Settings shows at the top of the section. */
export function describeAi(status: AiStatus, available: boolean): string {
  if (!available) return 'Unsupported in this runtime'
  if (!status.configured) return 'Not configured'
  if (status.lastError !== null && !status.enabled) return 'Error'
  return status.enabled ? 'Enabled' : 'Configured · switched off'
}

export function useAiSettings() {
  const available = platform.ai.isAvailable
  const [status, setStatus] = useState<AiStatus>(IDLE)
  const [notice, setNotice] = useState<AiNotice>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await platform.ai.status())
    } catch (error) {
      // A status that cannot be read is an assistant problem, not a Settings
      // problem: it lands in this section's own error field and the rest of the
      // screen never notices. Letting it reject would strand the section on a
      // stale status with no explanation — the M14 lesson, applied here.
      setStatus((previous) => ({
        ...previous,
        lastError: error instanceof Error ? error.message : 'Could not read the assistant status.',
      }))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async (label: string, action: () => Promise<AiStatus | string>) => {
      setBusy(true)
      setNotice(null)
      try {
        const result = await action()
        if (typeof result === 'string') setNotice({ ok: true, text: result })
        else setStatus(result)
        await refresh()
      } catch (error) {
        const text =
          error instanceof AiError || error instanceof Error ? error.message : `${label} failed`
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
      /** The key goes straight to the OS credential store and is never returned. */
      configure: (apiKey: string) =>
        run('Saving the key', async () => {
          await platform.ai.configure(apiKey)
          return 'Saved. The assistant is still switched off until you enable it.'
        }),
      test: () =>
        run('Testing', async () => {
          const probe = await platform.ai.test()
          return `Provider reachable — ${probe.model}.`
        }),
      setEnabled: (enabled: boolean) => run('Saving', () => platform.ai.setEnabled(enabled)),
      disconnect: () => run('Disconnecting', () => platform.ai.disconnect()),
    }),
    [run],
  )

  return { available, status, notice, busy, refresh, ...actions }
}
