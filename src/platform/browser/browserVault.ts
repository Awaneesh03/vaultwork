import { assertSafeVaultPath } from '@/integrations/obsidian/vaultPath'
import {
  VaultError,
  type VaultConnection,
  type VaultEntry,
  type VaultPermission,
  type VaultPort,
} from '../ports'

/**
 * The File System Access API adapter.
 *
 * This is the only file in the application that names `showDirectoryPicker`,
 * `FileSystemDirectoryHandle` or `queryPermission`. Everything above it speaks
 * `VaultPort`, which is what lets M13 add a Tauri adapter without the notes
 * feature noticing.
 *
 * Three things about this API shape the code below:
 *
 *  1. **The picker requires a user gesture.** `connect` and `requestPermission`
 *     must be called straight from a click; called from an effect they throw.
 *
 *  2. **Handles are structured-cloneable and survive in IndexedDB, but the
 *     permission does not.** A handle restored after a reload usually comes
 *     back in the `prompt` state, so it is stored, restored, and then *asked*
 *     rather than trusted. Chromium can return `granted` for a handle the user
 *     marked as always-allowed; both outcomes are handled.
 *
 *  3. **Only Chromium implements it.** Firefox and Safari have neither
 *     `showDirectoryPicker` nor the handle types, so support is feature-tested
 *     and the failure is a plain message rather than a crash.
 */

// The DOM lib in this TypeScript version has no File System Access types, so
// the shapes this adapter uses are declared here rather than pulled in as a
// dependency. Nothing outside this file sees them.
interface FsPermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FsHandle {
  kind: 'file' | 'directory'
  name: string
  queryPermission?: (descriptor?: FsPermissionDescriptor) => Promise<PermissionState>
  requestPermission?: (descriptor?: FsPermissionDescriptor) => Promise<PermissionState>
}

interface FsWritable {
  write: (data: string) => Promise<void>
  close: () => Promise<void>
}

interface FsFileHandle extends FsHandle {
  kind: 'file'
  getFile: () => Promise<Blob>
  createWritable: () => Promise<FsWritable>
}

interface FsDirectoryHandle extends FsHandle {
  kind: 'directory'
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FsFileHandle>
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FsDirectoryHandle>
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>
  values: () => AsyncIterableIterator<FsFileHandle | FsDirectoryHandle>
}

type PickerWindow = typeof globalThis & {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite'
    id?: string
    startIn?: string
  }) => Promise<FsDirectoryHandle>
}

const picker = (): PickerWindow['showDirectoryPicker'] =>
  (globalThis as PickerWindow).showDirectoryPicker

export function isFileSystemAccessSupported(): boolean {
  return typeof picker() === 'function'
}

/**
 * Where the directory handle is kept between sessions.
 *
 * Its own tiny IndexedDB database rather than a row in the Dexie one: a handle
 * is a browser object, not application data. It must never end up inside a
 * backup export, and keeping it out of the main schema makes that structural
 * rather than a rule someone has to remember.
 */
const HANDLE_DB = 'vaultwork-vault-handle'
const HANDLE_STORE = 'handles'
const HANDLE_KEY = 'vault'

function openHandleStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveHandle(handle: FsDirectoryHandle | null): Promise<void> {
  try {
    const db = await openHandleStore()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite')
      const store = tx.objectStore(HANDLE_STORE)
      if (handle === null) store.delete(HANDLE_KEY)
      else store.put(handle, HANDLE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Persisting is a convenience. A browser that refuses to structured-clone
    // the handle simply means the user reconnects next time, which is the
    // documented fallback rather than an error worth surfacing.
  }
}

async function loadHandle(): Promise<FsDirectoryHandle | null> {
  try {
    const db = await openHandleStore()
    const handle = await new Promise<FsDirectoryHandle | null>((resolve) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly')
      const request = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY)
      request.onsuccess = () => resolve((request.result as FsDirectoryHandle) ?? null)
      request.onerror = () => resolve(null)
    })
    db.close()
    return handle
  } catch {
    return null
  }
}

function describe(error: unknown): { kind: 'aborted' | 'permission-denied' | null } {
  const name = error instanceof Error ? error.name : ''
  if (name === 'AbortError') return { kind: 'aborted' }
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'permission-denied' }
  return { kind: null }
}

export function createBrowserVault(): VaultPort {
  let handle: FsDirectoryHandle | null = null

  const connection = (): VaultConnection | null =>
    handle === null ? null : { name: handle.name, restorable: true }

  const requireHandle = (): FsDirectoryHandle => {
    if (handle === null) {
      throw new VaultError('not-connected', 'No Obsidian vault is connected.')
    }
    return handle
  }

  /**
   * Walks to a directory, optionally creating it.
   *
   * Every path passes `assertSafeVaultPath` first, so traversal is rejected
   * before a single handle is resolved — the check is the boundary of the
   * permission the user granted, not a formatting nicety.
   */
  const directoryFor = async (
    path: string,
    options: { create: boolean },
  ): Promise<FsDirectoryHandle> => {
    let current = requireHandle()
    const segments = path.split('/').filter((segment) => segment.length > 0)

    for (const segment of segments) {
      try {
        current = await current.getDirectoryHandle(segment, { create: options.create })
      } catch (error) {
        const { kind } = describe(error)
        if (kind === 'permission-denied') {
          throw new VaultError('permission-denied', 'Permission to the vault was denied.', path)
        }
        throw new VaultError('not-found', `Folder “${segment}” is not in the vault.`, path)
      }
    }
    return current
  }

  const fileFor = async (
    path: string,
    options: { create: boolean; extension?: 'document' },
  ): Promise<FsFileHandle> => {
    const safe = assertSafeVaultPath(
      path,
      options.extension ? { extension: options.extension } : {},
    )
    const segments = safe.split('/')
    const name = segments.pop() as string
    const directory = await directoryFor(segments.join('/'), { create: options.create })

    try {
      return await directory.getFileHandle(name, { create: options.create })
    } catch (error) {
      const { kind } = describe(error)
      if (kind === 'permission-denied') {
        throw new VaultError('permission-denied', 'Permission to the vault was denied.', safe)
      }
      throw new VaultError('not-found', `“${safe}” is not in the vault.`, safe)
    }
  }

  const permissionOf = async (
    target: FsDirectoryHandle | null,
    prompt: boolean,
  ): Promise<VaultPermission> => {
    if (!isFileSystemAccessSupported()) return 'unavailable'
    if (target === null) return 'prompt'

    const ask = prompt ? target.requestPermission : target.queryPermission
    // A handle from an older browser may expose neither; assume the optimistic
    // case and let the first real operation fail loudly instead.
    if (typeof ask !== 'function') return 'granted'

    try {
      const state = await ask.call(target, { mode: 'readwrite' })
      return state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt'
    } catch {
      return 'denied'
    }
  }

  return {
    id: 'browser-fsaa',
    get isSupported() {
      return isFileSystemAccessSupported()
    },

    async connect() {
      const open = picker()
      if (typeof open !== 'function') {
        throw new VaultError(
          'unsupported',
          'Obsidian filesystem access is not supported in this browser. Chromium-based browsers (Chrome, Edge, Arc, Brave) support it; Firefox and Safari do not.',
        )
      }

      try {
        // `id` makes the browser reopen the last-used folder next time, and
        // `readwrite` asks for write permission up front rather than
        // interrupting the user again on their first export.
        const chosen = await open({ mode: 'readwrite', id: 'vaultwork-vault' })
        handle = chosen
        await saveHandle(chosen)
        return { name: chosen.name, restorable: true }
      } catch (error) {
        const { kind } = describe(error)
        if (kind === 'aborted') {
          throw new VaultError('aborted', 'No folder was chosen.')
        }
        throw new VaultError('permission-denied', 'The browser refused access to that folder.')
      }
    },

    async disconnect() {
      handle = null
      await saveHandle(null)
    },

    current: connection,

    async permission() {
      return permissionOf(handle, false)
    },

    async requestPermission() {
      const target = handle
      if (target === null) return isFileSystemAccessSupported() ? 'prompt' : 'unavailable'
      return permissionOf(target, true)
    },

    async restore() {
      if (!isFileSystemAccessSupported()) return null
      const stored = await loadHandle()
      if (stored === null) return null

      handle = stored
      // Deliberately *not* requesting permission here: restore runs at startup,
      // outside a user gesture, and a silent prompt would be rejected anyway.
      // The caller asks `permission()` and shows "Permission required".
      return { name: stored.name, restorable: true }
    },

    /**
     * Not available in the browser.
     *
     * Parsing a PDF here would mean shipping a parser into the renderer bundle
     * for a build that is a development convenience, not the product. The
     * desktop adapter extracts natively; this says so plainly rather than
     * returning an empty document, which would be indistinguishable from a
     * scanned page and would quietly index nothing.
     */
    async readPdfText(path: string): Promise<never> {
      throw new VaultError(
        'unsupported',
        'Reading PDFs needs the desktop app. The browser build reads Markdown only.',
        path,
      )
    },

    async readFile(path) {
      const file = await fileFor(path, { create: false })
      try {
        return await (await file.getFile()).text()
      } catch (error) {
        const { kind } = describe(error)
        if (kind === 'permission-denied') {
          throw new VaultError(
            'permission-denied',
            'Permission to read the vault was denied.',
            path,
          )
        }
        throw new VaultError('read-failed', `Could not read “${path}”.`, path)
      }
    },

    async writeFile(path, contents) {
      const file = await fileFor(path, { create: true })
      try {
        const writable = await file.createWritable()
        await writable.write(contents)
        await writable.close()
      } catch (error) {
        const { kind } = describe(error)
        if (kind === 'permission-denied') {
          throw new VaultError(
            'permission-denied',
            'Permission to write to the vault was denied.',
            path,
          )
        }
        throw new VaultError('write-failed', `Could not write “${path}”.`, path)
      }
    },

    async deleteFile(path) {
      const safe = assertSafeVaultPath(path)
      const segments = safe.split('/')
      const name = segments.pop() as string
      const directory = await directoryFor(segments.join('/'), { create: false })

      try {
        await directory.removeEntry(name)
      } catch (error) {
        const { kind } = describe(error)
        if (kind === 'permission-denied') {
          throw new VaultError('permission-denied', 'Permission to delete was denied.', safe)
        }
        throw new VaultError('not-found', `“${safe}” is not in the vault.`, safe)
      }
    },

    async exists(path) {
      try {
        // Read-only, so either document kind is a fair question to ask.
        await fileFor(path, { create: false, extension: 'document' })
        return true
      } catch (error) {
        // A permission problem is not the same as absence, and reporting it as
        // "does not exist" would let an export overwrite a file it cannot see.
        if (error instanceof VaultError && error.kind === 'permission-denied') throw error
        return false
      }
    },

    async createDirectory(path) {
      // Idempotent by construction: `create: true` returns the existing handle.
      await directoryFor(path, { create: true })
    },

    async listDirectory(path = '') {
      const directory = await directoryFor(path, { create: false })
      const entries: VaultEntry[] = []

      for await (const child of directory.values()) {
        entries.push({
          name: child.name,
          path: path.length === 0 ? child.name : `${path}/${child.name}`,
          kind: child.kind === 'directory' ? 'directory' : 'file',
        })
      }

      return entries.sort((a, b) => a.name.localeCompare(b.name))
    },
  }
}

export const browserVault: VaultPort = createBrowserVault()
