import { useCallback, useEffect, useRef, useState } from 'react'
import { getSource, type SourceDescription } from '@/services'
import { SOURCE_IDS, type SourceId } from '@/types/enums'

export interface SourcesController {
  /**
   * One entry per source, in registry order. `undefined` while that source is
   * still being asked — each row answers on its own.
   */
  rows: { id: SourceId; source: SourceDescription | undefined }[]
  refreshing: boolean
  refresh: () => void
}

/**
 * The source registry, for Settings (M18.4).
 *
 * Every source is read separately, so one integration whose status call hangs
 * — the exact failure Settings already refuses to be held hostage by for
 * Telegram — leaves its own row saying "Checking…" and every other row
 * answered. Read on mount and on request; never polled, because each read is a
 * real call into an integration, and some of those reach the keychain.
 */
export function useSources(): SourcesController {
  const [sources, setSources] = useState<Partial<Record<SourceId, SourceDescription>>>({})
  const [pending, setPending] = useState(0)
  // A newer refresh makes older answers irrelevant; they are dropped, not merged.
  const generation = useRef(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    const current = ++generation.current
    setSources({})
    setPending(SOURCE_IDS.length)
    for (const id of SOURCE_IDS) {
      void getSource(id)
        .then((source) => {
          if (!alive.current || generation.current !== current) return
          setSources((previous) => ({ ...previous, [id]: source }))
        })
        .finally(() => {
          if (alive.current && generation.current === current) setPending((n) => n - 1)
        })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    rows: SOURCE_IDS.map((id) => ({ id, source: sources[id] })),
    refreshing: pending > 0,
    refresh,
  }
}
