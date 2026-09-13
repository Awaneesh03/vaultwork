import {
  assertSafeVaultDirectory,
  assertSafeVaultPath,
  UnsafeVaultPathError,
} from '@/integrations/obsidian/vaultPath'
import {
  VaultError,
  type VaultConnection,
  type VaultEntry,
  type VaultErrorKind,
  type VaultPermission,
  type VaultPort,
} from '../ports'
import type { BridgeFailure, TauriBridge } from './bridge'

/**
 * The desktop vault adapter.
 *
 * The same `VaultPort` the browser adapter implements, backed by a real
 * filesystem instead of a `FileSystemDirectoryHandle`. Everything above it —
 * `obsidianService`, the M11 sync plan, the note editor, the knowledge graph —
 * is unchanged and unaware, which is the entire point of having had a port
 * since M10.
 *
 * Three differences from the browser, each of which the port already had
 * vocabulary for:
 *
 *  1. **Permission is liveness, not a grant.** A desktop app is not sandboxed,
 *     so there is nothing to re-prompt for; `permission()` instead asks whether
 *     the folder is still readable. An unplugged drive reports `denied` rather
 *     than a confident `granted` followed by failures.
 *
 *  2. **Restore actually restores.** The browser stores a handle whose
 *     permission usually lapses; here the remembered path either still exists
 *     or it does not, and `requestPermission()` is honest about having nothing
 *     to ask.
 *
 *  3. **Paths must be checked here.** The File System Access API resolves one
 *     named segment at a time and rejects `..` itself. A native filesystem
 *     will happily follow it, so every path is validated in TypeScript *and*
 *     again in Rust before it reaches `std::fs`.
 */

/** Bridge failures carry a `kind` string; only known ones are trusted. */
const KINDS: ReadonlySet<string> = new Set<VaultErrorKind>([
  'unsupported',
  'not-connected',
  'permission-denied',
  'not-found',
  'invalid-path',
  'write-failed',
  'read-failed',
  'aborted',
])

function isBridgeFailure(value: unknown): value is BridgeFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as { kind: unknown }).kind === 'string'
  )
}

/**
 * Turns whatever came back across the IPC boundary into a `VaultError`.
 *
 * A raw Rust panic string or an `io::Error` never reaches the UI. The Rust side
 * already maps `ErrorKind` onto the port's vocabulary; this handles the two
 * cases it cannot — an unrecognised kind, and a failure that was never a
 * `VaultFailure` at all (the IPC transport itself breaking, say).
 */
function toVaultError(error: unknown, fallback: VaultErrorKind, path: string | null): VaultError {
  if (error instanceof VaultError) return error

  if (error instanceof UnsafeVaultPathError) {
    return new VaultError('invalid-path', error.message, error.path)
  }

  if (isBridgeFailure(error)) {
    const kind = KINDS.has(error.kind) ? (error.kind as VaultErrorKind) : fallback
    const message =
      typeof error.message === 'string' && error.message.length > 0
        ? error.message
        : 'The vault could not complete that operation.'
    return new VaultError(kind, message, error.path ?? path)
  }

  // Deliberately not `String(error)`: an unexpected failure from the native
  // side may carry an absolute path or an OS message, and neither belongs in
  // front of a user.
  return new VaultError(fallback, 'The desktop vault could not complete that operation.', path)
}

export function createTauriVault(bridge: TauriBridge): VaultPort {
  // Mirrors what Rust holds, so `current()` can stay synchronous — the port
  // declares it that way, and the browser adapter answers from a handle it
  // already has for the same reason.
  let connection: VaultConnection | null = null

  const toPermission = (raw: string): VaultPermission =>
    raw === 'granted' || raw === 'denied' || raw === 'prompt' || raw === 'unavailable'
      ? raw
      : 'denied'

  return {
    id: 'tauri-fs',
    isSupported: true,

    async connect() {
      try {
        const chosen = await bridge.vaultConnect()
        if (chosen === null) {
          throw new VaultError('aborted', 'No folder was chosen.')
        }
        connection = { name: chosen.name, restorable: true }
        return connection
      } catch (error) {
        connection = null
        throw toVaultError(error, 'permission-denied', null)
      }
    },

    async disconnect() {
      // Forgets the folder and nothing else. Notes, tasks, goals and habits are
      // in IndexedDB and are not the vault's to touch — the same guarantee M10
      // made, kept on a runtime that could physically do otherwise.
      connection = null
      try {
        await bridge.vaultDisconnect()
      } catch {
        // The renderer has already forgotten it; a native side that failed to
        // write its state file is not a reason to refuse the disconnect.
      }
    },

    current() {
      return connection
    },

    async permission() {
      if (connection === null) return 'prompt'
      try {
        return toPermission(await bridge.vaultPermission())
      } catch {
        return 'denied'
      }
    },

    async requestPermission() {
      // There is no prompt to raise: a desktop process either can read the
      // folder or cannot. Re-asking the live state is the honest answer, and
      // pretending to prompt would put a button in the UI that does nothing.
      if (connection === null) return 'prompt'
      try {
        return toPermission(await bridge.vaultPermission())
      } catch {
        return 'denied'
      }
    },

    async restore() {
      try {
        const found = await bridge.vaultRestore()
        connection = found === null ? null : { name: found.name, restorable: true }
        return connection
      } catch {
        // A vault that cannot be restored is not an error at start-up; it is a
        // vault the user reconnects.
        connection = null
        return null
      }
    },

    async readFile(path) {
      const safe = assertSafeVaultPath(path)
      try {
        return await bridge.vaultRead(safe)
      } catch (error) {
        throw toVaultError(error, 'read-failed', safe)
      }
    },

    async writeFile(path, contents) {
      const safe = assertSafeVaultPath(path)
      try {
        await bridge.vaultWrite(safe, contents)
      } catch (error) {
        throw toVaultError(error, 'write-failed', safe)
      }
    },

    async deleteFile(path) {
      const safe = assertSafeVaultPath(path)
      try {
        await bridge.vaultDelete(safe)
      } catch (error) {
        throw toVaultError(error, 'write-failed', safe)
      }
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
      try {
        return await bridge.vaultExists(safe)
      } catch (error) {
        const failure = toVaultError(error, 'read-failed', safe)
        // Absence and inaccessibility are different answers. Reporting a
        // permission failure as "does not exist" would let an export overwrite
        // a file it could not see.
        if (failure.kind === 'not-found') return false
        throw failure
      }
    },

    async createDirectory(path) {
      const safe = assertSafeVaultDirectory(path)
      try {
        await bridge.vaultCreateDirectory(safe)
      } catch (error) {
        throw toVaultError(error, 'write-failed', safe)
      }
    },

    /**
     * PDF text, extracted natively.
     *
     * The parse happens in Rust and only text crosses the bridge — the renderer
     * never receives a PDF's bytes, and there is no command that would give it
     * any. The path goes through the same directory-safety check every other
     * operation uses, so a document outside the vault cannot be reached through
     * this route either.
     */
    async readPdfText(path: string) {
      const safe = assertSafeVaultPath(path, { extension: '.pdf' })
      try {
        const raw = await bridge.vaultReadPdfText(safe)
        return {
          text: raw.text,
          chars: raw.chars,
          empty: raw.empty,
          truncated: raw.truncated,
          bytes: raw.bytes,
        }
      } catch (error) {
        throw toVaultError(error, 'read-failed', safe)
      }
    },

    async listDirectory(path = '') {
      // The vault root is the empty string, which is not a path to validate.
      const safe = path.length === 0 ? '' : assertSafeVaultDirectory(path)
      try {
        const entries = await bridge.vaultList(safe.length === 0 ? undefined : safe)
        return (
          entries
            .map((entry): VaultEntry => ({
              name: entry.name,
              path: entry.path,
              kind: entry.kind === 'directory' ? 'directory' : 'file',
            }))
            // Sorted here, not in Rust, so both runtimes agree. Rust's `str::cmp`
            // is byte order — which puts `README.md` before `notes` — while the
            // browser adapter uses `localeCompare`, which does not. M11 walks
            // this list to build a sync plan, and two runtimes disagreeing about
            // the order of a vault scan is exactly the kind of difference that
            // shows up much later as an unexplained diff.
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      } catch (error) {
        throw toVaultError(error, 'read-failed', safe.length === 0 ? null : safe)
      }
    },
  }
}
