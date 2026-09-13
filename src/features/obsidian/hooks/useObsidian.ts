import { useCallback, useEffect, useRef, useState } from 'react'
import {
  connectVault,
  deleteFromVault,
  disconnectVault,
  exportAllNotes,
  exportNote,
  getNoteSyncReport,
  getVaultStatus,
  importNote,
  previewImport,
  renameVaultFile,
  requestVaultPermission,
  restoreVault,
  scanVault,
  suggestedVaultPath,
  type BulkExportResult,
  type ImportPreview,
  type NoteSyncReport,
  type VaultScan,
  type VaultStatus,
} from '@/services'
import type { Id } from '@/types/entities'

/**
 * The Obsidian integration, for components.
 *
 * The only route from the UI to a filesystem. No component imports the vault
 * port, the browser adapter or `showDirectoryPicker` — the architecture test
 * enforces that, and this hook is what makes obeying it easy.
 *
 * Nothing here polls or scans on render. A vault scan reads every managed file,
 * which is far too expensive to happen because React re-rendered, so every
 * filesystem operation is triggered by an explicit call.
 */

export interface ObsidianController {
  status: VaultStatus | null
  busy: boolean
  error: string | null
  clearError: () => void

  connect: () => Promise<void>
  disconnect: () => Promise<void>
  grantPermission: () => Promise<void>
  refresh: () => Promise<void>
}

/** Turns any thrown value into something a person can read. */
function readable(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'Something went wrong reaching the vault.'
}

export function useVaultConnection(): ObsidianController {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = useCallback(async (operation: () => Promise<VaultStatus>) => {
    setBusy(true)
    setError(null)
    try {
      const next = await operation()
      if (alive.current) setStatus(next)
    } catch (thrown) {
      if (alive.current) setError(readable(thrown))
      // The status may itself have changed (permission revoked), so re-read it
      // rather than leaving the UI showing a state that no longer holds.
      try {
        const recovered = await getVaultStatus()
        if (alive.current) setStatus(recovered)
      } catch {
        /* Reporting the original failure matters more than this one. */
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  // One attempt at startup to bring back a previously granted folder. It never
  // prompts — a permission prompt outside a user gesture is rejected anyway.
  useEffect(() => {
    void run(restoreVault)
  }, [run])

  return {
    status,
    busy,
    error,
    clearError: () => setError(null),
    connect: () => run(connectVault),
    disconnect: () => run(disconnectVault),
    grantPermission: () => run(requestVaultPermission),
    refresh: () => run(getVaultStatus),
  }
}

export interface NoteObsidianController {
  report: NoteSyncReport | null
  busy: boolean
  error: string | null
  message: string | null
  refresh: () => Promise<void>
  exportToVault: (options?: { overwriteExternalChanges?: boolean }) => Promise<void>
  importFromVault: (options?: { overwriteLocalChanges?: boolean }) => Promise<void>
  renameTo: (path: string) => Promise<void>
  deleteFile: (options?: { force?: boolean }) => Promise<void>
  suggestPath: () => Promise<string>
}

/**
 * One note's relationship with the vault.
 *
 * `refresh` reads the file to compare it — which is why it is a function the
 * caller invokes rather than something that happens on mount for every note in
 * a list.
 */
export function useNoteObsidian(noteId: Id | null, connected: boolean): NoteObsidianController {
  const [report, setReport] = useState<NoteSyncReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (noteId === null || !connected) {
      setReport(null)
      return
    }
    setBusy(true)
    try {
      setReport(await getNoteSyncReport(noteId))
      setError(null)
    } catch (thrown) {
      setError(readable(thrown))
    } finally {
      setBusy(false)
    }
  }, [noteId, connected])

  // Comparing one open note is a single file read, which is cheap enough to do
  // when the note or the connection changes — but never on every render.
  useEffect(() => {
    void refresh()
  }, [refresh])

  const act = useCallback(
    async (operation: () => Promise<string>) => {
      if (noteId === null) return
      setBusy(true)
      setError(null)
      setMessage(null)
      try {
        setMessage(await operation())
      } catch (thrown) {
        setError(readable(thrown))
      } finally {
        setBusy(false)
        await refresh()
      }
    },
    [noteId, refresh],
  )

  return {
    report,
    busy,
    error,
    message,
    refresh,
    exportToVault: (options = {}) =>
      act(async () => (await exportNote(noteId as Id, options)).message),
    importFromVault: (options = {}) =>
      act(async () => {
        const path = report?.vaultPath
        if (!path) throw new Error('This note has no vault file to import from.')
        return (await importNote(path, options)).message
      }),
    renameTo: (path: string) =>
      act(async () => (await renameVaultFile(noteId as Id, path)).message),
    deleteFile: (options = {}) =>
      act(async () => (await deleteFromVault(noteId as Id, options)).message),
    suggestPath: () => suggestedVaultPath(noteId as Id),
  }
}

export interface VaultScanController {
  scan: VaultScan | null
  busy: boolean
  error: string | null
  run: () => Promise<void>
  exportAll: () => Promise<BulkExportResult | null>
  preview: (path: string) => Promise<ImportPreview | null>
  importFile: (path: string, options?: { overwriteLocalChanges?: boolean }) => Promise<void>
}

/**
 * A whole-vault scan.
 *
 * Deliberately manual. The milestone forbids an aggressive "sync everything"
 * button, so the flow is scan first, look at what it found, then choose — which
 * is exactly the shape of this controller.
 */
export function useVaultScan(): VaultScanController {
  const [scan, setScan] = useState<VaultScan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setScan(await scanVault())
    } catch (thrown) {
      setError(readable(thrown))
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    scan,
    busy,
    error,
    run,
    exportAll: async () => {
      setBusy(true)
      setError(null)
      try {
        const result = await exportAllNotes()
        setScan(await scanVault())
        return result
      } catch (thrown) {
        setError(readable(thrown))
        return null
      } finally {
        setBusy(false)
      }
    },
    preview: async (path: string) => {
      try {
        return await previewImport(path)
      } catch (thrown) {
        setError(readable(thrown))
        return null
      }
    },
    importFile: async (path: string, options = {}) => {
      setBusy(true)
      setError(null)
      try {
        await importNote(path, options)
        setScan(await scanVault())
      } catch (thrown) {
        setError(readable(thrown))
      } finally {
        setBusy(false)
      }
    },
  }
}
