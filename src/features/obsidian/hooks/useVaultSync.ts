import { useCallback, useState } from 'react'
import {
  applySync,
  describeSyncResult,
  loadComparison,
  scanVaultPlan,
  type SyncComparison,
  type SyncDecision,
  type SyncItem,
  type SyncPlan,
  type SyncResult,
} from '@/services'

/**
 * The scan → decide → apply workflow, for components.
 *
 * Deliberately has no effect that starts a scan. A scan reads every Markdown
 * file in the vault; doing that because a component mounted would make opening
 * the screen expensive and would fight the user's decisions by replacing the
 * plan under them. Both operations are functions the UI calls.
 */

export interface VaultSyncController {
  plan: SyncPlan | null
  decisions: Record<string, SyncDecision>
  result: SyncResult | null
  scanning: boolean
  applying: boolean
  error: string | null

  scan: () => Promise<void>
  decide: (key: string, decision: SyncDecision) => void
  decideAll: (next: Record<string, SyncDecision>) => void
  apply: () => Promise<void>
  dismissResult: () => void
  /** Reads both versions of one item, for the comparison view. */
  compare: (item: SyncItem) => Promise<SyncComparison | null>
}

function readable(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'Something went wrong reaching the vault.'
}

export function useVaultSync(): VaultSyncController {
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [decisions, setDecisions] = useState<Record<string, SyncDecision>>({})
  const [result, setResult] = useState<SyncResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setScanning(true)
    setError(null)
    setResult(null)
    try {
      const next = await scanVaultPlan()
      setPlan(next)
      // Every item starts on "skip". Nothing is chosen for the user.
      setDecisions(Object.fromEntries(next.items.map((item) => [item.key, 'skip' as const])))
    } catch (thrown) {
      setError(readable(thrown))
      setPlan(null)
    } finally {
      setScanning(false)
    }
  }, [])

  const apply = useCallback(async () => {
    if (plan === null) return
    setApplying(true)
    setError(null)
    try {
      const outcome = await applySync(plan, decisions)
      setResult(outcome)
      // Re-scan so the screen reflects what actually happened rather than what
      // was asked for — some items may have gone stale or failed.
      const next = await scanVaultPlan()
      setPlan(next)
      setDecisions(Object.fromEntries(next.items.map((item) => [item.key, 'skip' as const])))
    } catch (thrown) {
      setError(readable(thrown))
    } finally {
      setApplying(false)
    }
  }, [plan, decisions])

  return {
    plan,
    decisions,
    result,
    scanning,
    applying,
    error,
    scan,
    decide: (key, decision) => setDecisions((current) => ({ ...current, [key]: decision })),
    decideAll: setDecisions,
    apply,
    dismissResult: () => setResult(null),
    compare: async (item) => {
      try {
        return await loadComparison(item)
      } catch (thrown) {
        setError(readable(thrown))
        return null
      }
    },
  }
}

export { describeSyncResult }
