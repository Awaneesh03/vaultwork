import { useCallback, useEffect, useState } from 'react'
import { getStorageReport, requestPersistence, type StorageReport } from '@/services'

/**
 * Storage status is not a Dexie row, so it is not a live query — it is read
 * once and re-read after the user asks for persistence.
 */
export function useStorageReport() {
  const [report, setReport] = useState<StorageReport | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setReport(await getStorageReport())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const request = useCallback(async () => {
    setBusy(true)
    try {
      await requestPersistence()
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh])

  return { report, busy, request, refresh }
}
