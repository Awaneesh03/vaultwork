import { assertSafeVaultPath } from '@/integrations/obsidian/vaultPath'
import {
  VaultError,
  type VaultConnection,
  type VaultEntry,
  type VaultPermission,
  type VaultPort,
} from '../ports'

/**
 * An in-memory vault.
 *
 * Exists so the Obsidian service can be tested without a real filesystem and
 * without a developer's actual Obsidian installation. It implements the same
 * `VaultPort` the browser adapter does — which is itself the proof that the
 * boundary is real: if the service can be driven by this, a Tauri adapter can
 * drive it too.
 *
 * Deliberately strict rather than forgiving. It applies the same path checks,
 * refuses to write into a directory that does not exist, and can be told to
 * fail a specific operation — because the interesting tests are the ones where
 * the filesystem misbehaves halfway through.
 */

export interface MemoryVaultOptions {
  name?: string
  supported?: boolean
  permission?: VaultPermission
  /** Files present before the test starts, keyed by vault-relative path. */
  files?: Record<string, string>
}

export interface MemoryVault extends VaultPort {
  /** Direct access for assertions — never used by the service under test. */
  readonly files: Map<string, string>
  readonly directories: Set<string>
  /** Fails the next matching call once, to exercise partial failure. */
  failNext(operation: 'read' | 'list' | 'write' | 'delete' | 'mkdir', error: VaultError): void
  /**
   * Makes one folder permanently unreadable.
   *
   * Path-targeted and persistent, unlike `failNext`: a scan lists many folders,
   * and "this one folder refuses" is a different scenario from "the next call
   * fails". The vault root is the empty string.
   */
  failListing(path: string, error: VaultError): void
  setPermission(permission: VaultPermission): void
  /** Runs after each successful write — used to simulate a mid-batch change. */
  afterWrite: ((path: string) => void) | null
  /** Writes a file as if an external editor had, bypassing path rules. */
  seed(path: string, contents: string): void
  /**
   * Puts a PDF in the vault, described by the text it would extract to.
   *
   * A real PDF's bytes are not something a test wants to carry, and the port
   * only ever hands back text, so the seam sits at the text: this stores what
   * extraction *would* produce. Seeding an empty string models the scanned page
   * — a genuine PDF that yields nothing.
   */
  seedPdf(path: string, text: string, options?: { bytes?: number }): void
}

/** Stands in for the native extractor's ceiling, small enough to reach in a test. */
const MEMORY_PDF_LIMIT = 5_000

export function createMemoryVault(options: MemoryVaultOptions = {}): MemoryVault {
  const files = new Map<string, string>()
  const directories = new Set<string>()
  let connected: VaultConnection | null = null
  let permission: VaultPermission = options.permission ?? 'granted'
  const supported = options.supported ?? true

  /** Extracted text per PDF path, plus the size the file claims on disk. */
  const pdfs = new Map<string, { text: string; bytes: number }>()
  const failures = new Map<string, VaultError>()
  const unreadableFolders = new Map<string, VaultError>()
  let afterWrite: ((path: string) => void) | null = null

  const ensureParents = (path: string) => {
    const segments = path.split('/')
    segments.pop()
    let current = ''
    for (const segment of segments) {
      current = current.length === 0 ? segment : `${current}/${segment}`
      directories.add(current)
    }
  }

  for (const [path, contents] of Object.entries(options.files ?? {})) {
    files.set(path, contents)
    ensureParents(path)
  }

  const check = (operation: string) => {
    if (!supported) throw new VaultError('unsupported', 'This build has no vault adapter.')
    if (connected === null) throw new VaultError('not-connected', 'No vault is connected.')
    if (permission !== 'granted') {
      throw new VaultError('permission-denied', 'Permission to the vault was denied.')
    }
    const failure = failures.get(operation)
    if (failure) {
      failures.delete(operation)
      throw failure
    }
  }

  const parentOf = (path: string): string => {
    const segments = path.split('/')
    segments.pop()
    return segments.join('/')
  }

  return {
    id: 'memory-vault',
    isSupported: supported,
    files,
    directories,

    failListing(path, error) {

      unreadableFolders.set(path, error)

    },


    failNext(operation, error) {
      failures.set(operation, error)
    },

    setPermission(next) {
      permission = next
    },

    get afterWrite() {
      return afterWrite
    },
    set afterWrite(next: ((path: string) => void) | null) {
      afterWrite = next
    },

    seed(path, contents) {
      files.set(path, contents)
      ensureParents(path)
    },

    seedPdf(path, text, seedOptions = {}) {
      // Present in `files` too, so the walk that lists a directory sees it —
      // the stored string is a stand-in for bytes and is never read as text.
      files.set(path, '%PDF-1.4 (test fixture)')
      pdfs.set(path, { text, bytes: seedOptions.bytes ?? Math.max(1024, text.length * 4) })
      ensureParents(path)
    },

    async connect() {
      if (!supported) throw new VaultError('unsupported', 'This build has no vault adapter.')
      connected = { name: options.name ?? 'TestVault', restorable: true }
      return connected
    },

    async disconnect() {
      connected = null
    },

    current: () => connected,

    async permission() {
      if (!supported) return 'unavailable'
      return connected === null ? 'prompt' : permission
    },

    async requestPermission() {
      if (!supported) return 'unavailable'
      if (permission === 'prompt') permission = 'granted'
      return permission
    },

    async restore() {
      return connected
    },

    async readFile(path) {
      const safe = assertSafeVaultPath(path)
      check('read')
      const contents = files.get(safe)
      if (contents === undefined) {
        throw new VaultError('not-found', `“${safe}” is not in the vault.`, safe)
      }
      return contents
    },

    async readPdfText(path) {
      const safe = assertSafeVaultPath(path, { extension: '.pdf' })
      check('read')
      if (!files.has(safe)) {
        throw new VaultError('not-found', `“${safe}” is not in the vault.`, safe)
      }
      /*
       * A `.pdf` that was never given text stands for the file a real vault is
       * full of: a scan, an encrypted document, something damaged. The native
       * extractor answers "no text" for all of those rather than failing, and so
       * does this — otherwise a test fixture would be exercising an error path
       * the real adapter does not take.
       */
      const found = pdfs.get(safe) ?? { text: '', bytes: files.get(safe)?.length ?? 0 }
      const truncated = found.text.length > MEMORY_PDF_LIMIT
      const text = truncated ? found.text.slice(0, MEMORY_PDF_LIMIT) : found.text
      return {
        text,
        chars: text.length,
        empty: text.trim().length === 0,
        truncated,
        bytes: found.bytes,
      }
    },

    async writeFile(path, contents) {
      const safe = assertSafeVaultPath(path)
      check('write')
      const parent = parentOf(safe)
      // A real filesystem will not create a file inside a folder that does not
      // exist, so neither does this — otherwise the directory-creation step
      // would be untested and would break only against a real vault.
      if (parent.length > 0 && !directories.has(parent)) {
        throw new VaultError('not-found', `Folder “${parent}” is not in the vault.`, safe)
      }
      files.set(safe, contents)
      afterWrite?.(safe)
    },

    async deleteFile(path) {
      const safe = assertSafeVaultPath(path)
      check('delete')
      if (!files.has(safe)) {
        throw new VaultError('not-found', `“${safe}” is not in the vault.`, safe)
      }
      files.delete(safe)
    },

    /**
     * Existence, for either document kind.
     *
     * A read-only question, so it accepts `.md` and `.pdf` alike; the traversal
     * rules are unchanged. Insisting on `.md` here would make every existence
     * check on a PDF throw, which is how the staleness guard came to report
     * every document as stale.
     */
    async exists(path) {
      const safe = assertSafeVaultPath(path, { extension: 'document' })
      if (!supported || connected === null) return false
      if (permission !== 'granted') {
        throw new VaultError('permission-denied', 'Permission to the vault was denied.', safe)
      }
      return files.has(safe)
    },

    async createDirectory(path) {
      check('mkdir')
      if (path.length === 0) return
      // Idempotent, and creates every ancestor, exactly as the browser adapter
      // does by walking with `create: true`.
      let current = ''
      for (const segment of path.split('/').filter((part) => part.length > 0)) {
        current = current.length === 0 ? segment : `${current}/${segment}`
        directories.add(current)
      }
    },

    async listDirectory(path = '') {
      const refused = unreadableFolders.get(path)
      if (refused) throw refused
      check('list')
      const prefix = path.length === 0 ? '' : `${path}/`
      const entries = new Map<string, VaultEntry>()

      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        const [head, ...tail] = rest.split('/')
        if (head === undefined || head.length === 0) continue
        entries.set(head, {
          name: head,
          path: `${prefix}${head}`,
          kind: tail.length > 0 ? 'directory' : 'file',
        })
      }

      for (const directory of directories) {
        if (!directory.startsWith(prefix)) continue
        const rest = directory.slice(prefix.length)
        if (rest.length === 0 || rest.includes('/')) continue
        entries.set(rest, { name: rest, path: directory, kind: 'directory' })
      }

      return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
  }
}
