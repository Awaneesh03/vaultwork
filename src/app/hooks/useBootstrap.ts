import { useEffect, useState } from 'react'
import { bootstrapApp, startMcpSnapshotWriter, type BootstrapReport } from '@/services'

export type BootstrapState =
  | { status: 'loading' }
  | { status: 'ready'; report: BootstrapReport }
  | { status: 'failed'; error: Error }

/**
 * Start-up runs once, before anything renders that assumes a database.
 *
 * Seeding is gated on DEV: a build you actually use must never invent rows,
 * and `seedIfEmpty` refuses a non-empty database anyway.
 */
export function useBootstrap(): BootstrapState {
  const [state, setState] = useState<BootstrapState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    // Started only on success, and only on desktop (the writer checks): a
    // snapshot built from a database that would not open would describe a day
    // nobody has.
    let stopSnapshots: (() => void) | null = null

    void (async () => {
      const result = await bootstrapApp({ seed: import.meta.env.DEV })
      if (cancelled) return
      if (result.ok) stopSnapshots = startMcpSnapshotWriter()
      setState(
        result.ok
          ? { status: 'ready', report: result.value }
          : { status: 'failed', error: result.error },
      )
    })()
    return () => {
      cancelled = true
      stopSnapshots?.()
    }
  }, [])

  return state
}
