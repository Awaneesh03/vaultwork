import { useCallback, useMemo, useState } from 'react'
import {
  createSnapshot,
  downloadBackup,
  importBackup,
  listSnapshots,
  restoreSnapshot,
} from '@/services'
import type { SnapshotMeta } from '@/platform'

export interface ActionState {
  busy: boolean
  message: string | null
  error: string | null
}

const IDLE: ActionState = { busy: false, message: null, error: null }

/**
 * Export, import and snapshots, with the outcome of the last action kept so the
 * UI can say what happened instead of silently succeeding.
 */
export function useDataActions() {
  const [state, setState] = useState<ActionState>(IDLE)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | undefined>(undefined)

  const refreshSnapshots = useCallback(async () => {
    setSnapshots(await listSnapshots())
  }, [])

  const run = useCallback(
    async (label: string, action: () => Promise<{ ok: true; text: string } | { ok: false; text: string }>) => {
      setState({ busy: true, message: null, error: null })
      try {
        const result = await action()
        setState({
          busy: false,
          message: result.ok ? result.text : null,
          error: result.ok ? null : result.text,
        })
      } catch (error) {
        setState({
          busy: false,
          message: null,
          error: error instanceof Error ? error.message : `${label} failed`,
        })
      }
      await refreshSnapshots()
    },
    [refreshSnapshots],
  )

  const exportNow = useCallback(
    () =>
      run('Export', async () => {
        const result = await downloadBackup()
        return result.ok
          ? { ok: true as const, text: `Saved ${result.value}` }
          : { ok: false as const, text: result.error.message }
      }),
    [run],
  )

  const importFile = useCallback(
    (file: File) =>
      run('Import', async () => {
        const text = await file.text()
        const result = await importBackup(text)
        if (!result.ok) return { ok: false as const, text: result.error.message }
        const total = Object.values(result.value.restored).reduce((sum, n) => sum + n, 0)
        return { ok: true as const, text: `Restored ${total} rows from ${file.name}` }
      }),
    [run],
  )

  const snapshotNow = useCallback(
    () =>
      run('Snapshot', async () => {
        const result = await createSnapshot('manual')
        return result.ok
          ? { ok: true as const, text: `Snapshot ${result.value.id} saved` }
          : { ok: false as const, text: result.error.message }
      }),
    [run],
  )

  const restore = useCallback(
    (id: string) =>
      run('Restore', async () => {
        const result = await restoreSnapshot(id)
        return result.ok
          ? { ok: true as const, text: `Restored snapshot ${id}` }
          : { ok: false as const, text: result.error.message }
      }),
    [run],
  )

  /**
   * Memoised, so the object identity is stable across renders.
   *
   * Without this, `useEffect(…, [data])` in the settings screen re-ran on every
   * render — and since refreshing snapshots sets state with a fresh array, that
   * effect re-triggered itself forever. A quiet infinite loop: the screen
   * looked right while re-querying IndexedDB continuously.
   */
  return useMemo(
    () => ({ state, snapshots, refreshSnapshots, exportNow, importFile, snapshotNow, restore }),
    [state, snapshots, refreshSnapshots, exportNow, importFile, snapshotNow, restore],
  )
}
