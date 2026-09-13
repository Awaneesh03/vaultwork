import { useCallback, useEffect, useState } from 'react'
import { getDiagnostics, sendTestNotification, type Diagnostics } from '@/services'

/**
 * The developer-facing panel's data, plus the one notification M13 can send.
 *
 * Not a live query: none of this is a Dexie row that changes under you. It is
 * read on mount and re-read when the user asks, which is also what makes the
 * record count cheap enough to show at all.
 */
export function useDiagnostics() {
  const [report, setReport] = useState<Diagnostics | undefined>(undefined)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setReport(await getDiagnostics())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const testNotification = useCallback(async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await sendTestNotification()
      setNotice({ ok: result.ok, text: result.text })
    } finally {
      setBusy(false)
    }
  }, [])

  return { report, notice, busy, refresh, testNotification }
}
