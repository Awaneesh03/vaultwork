import { useEffect, useState } from 'react'
import { bootstrapApp, type BootstrapReport } from '@/services'

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
    void (async () => {
      const result = await bootstrapApp({ seed: import.meta.env.DEV })
      if (cancelled) return
      setState(
        result.ok
          ? { status: 'ready', report: result.value }
          : { status: 'failed', error: result.error },
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
