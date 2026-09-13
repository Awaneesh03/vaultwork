import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '@/services'
import type { Settings } from '@/types/entities'

/**
 * Settings, live.
 *
 * `useLiveQuery` re-runs whenever any Dexie table the callback touched changes,
 * so a settings write from anywhere in the app refreshes every consumer with no
 * store, no context and no invalidation logic. `undefined` means "still
 * loading" — the one thing every caller has to handle.
 */
export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(), [])
}
