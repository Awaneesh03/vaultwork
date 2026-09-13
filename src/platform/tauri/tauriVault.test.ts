import { beforeEach, describe, expect, it } from 'vitest'
import { UnsafeVaultPathError } from '@/integrations/obsidian/vaultPath'
import { VaultError, type VaultPort } from '../ports'
import { createFakeTauriBridge, type FakeTauriBridge } from './fakeBridge'
import { createTauriVault } from './tauriVault'

/**
 * The desktop vault adapter, driven against a fake native side.
 *
 * What is being tested is not "does `invoke` work" — that is Tauri's job and it
 * is four lines away in `bridge.ts`. It is whether the adapter honours the same
 * `VaultPort` contract the browser adapter does, translates every native
 * failure into the vocabulary the UI already speaks, and refuses to let a path
 * out of the vault.
 */

let bridge: FakeTauriBridge
let vault: VaultPort

beforeEach(() => {
  bridge = createFakeTauriBridge({ name: 'Second Brain' })
  vault = createTauriVault(bridge)
})

const connect = () => vault.connect()

describe('connecting', () => {
  it('reports itself supported and identifies as the desktop adapter', () => {
    expect(vault.isSupported).toBe(true)
    expect(vault.id).toBe('tauri-fs')
  })

  it('starts with no connection', () => {
    expect(vault.current()).toBeNull()
  })

  it('connects through the native picker and remembers the folder name', async () => {
    const connection = await connect()

    expect(connection).toEqual({ name: 'Second Brain', restorable: true })
    expect(vault.current()).toEqual({ name: 'Second Brain', restorable: true })
    expect(bridge.calls).toContain('vaultConnect')
  })

  it('reports a cancelled picker as aborted rather than a failure', async () => {
    bridge.setPicks(null)

    await expect(connect()).rejects.toMatchObject({ kind: 'aborted' })
    expect(vault.current()).toBeNull()
  })

  it('leaves nothing connected when the picker itself fails', async () => {
    bridge.failNext('vaultConnect', { kind: 'permission-denied', message: 'No.', path: null })

    await expect(connect()).rejects.toBeInstanceOf(VaultError)
    expect(vault.current()).toBeNull()
  })
})

describe('disconnecting', () => {
  it('forgets the folder on both sides', async () => {
    await connect()
    await vault.disconnect()

    expect(vault.current()).toBeNull()
    expect(bridge.calls).toContain('vaultDisconnect')
  })

  it('leaves every file in the vault untouched', async () => {
    bridge.seed('notes/a.md', 'kept')
    await connect()
    await vault.disconnect()

    // Disconnecting is forgetting where the vault is, never deleting from it.
    expect(bridge.files.get('notes/a.md')).toBe('kept')
  })

  it('still disconnects locally when the native side cannot save its state', async () => {
    await connect()
    bridge.failNext('vaultDisconnect', { kind: 'write-failed', message: 'Disk full.', path: null })

    await expect(vault.disconnect()).resolves.toBeUndefined()
    expect(vault.current()).toBeNull()
  })
})

describe('restoring', () => {
  it('reconnects a folder picked in a previous session', async () => {
    const previous = createTauriVault(
      createFakeTauriBridge({ remembered: 'Second Brain', picks: null }),
    )

    expect(await previous.restore()).toEqual({ name: 'Second Brain', restorable: true })
    expect(previous.current()).toEqual({ name: 'Second Brain', restorable: true })
  })

  it('returns null when nothing was remembered', async () => {
    const fresh = createTauriVault(createFakeTauriBridge({ remembered: null, picks: null }))

    expect(await fresh.restore()).toBeNull()
    expect(fresh.current()).toBeNull()
  })

  it('treats a failing restore as no vault rather than an error at start-up', async () => {
    bridge.failNext('vaultRestore', { kind: 'read-failed', message: 'Gone.', path: null })

    expect(await vault.restore()).toBeNull()
    expect(vault.current()).toBeNull()
  })
})

describe('permission', () => {
  it('is prompt while nothing is connected', async () => {
    expect(await vault.permission()).toBe('prompt')
    expect(await vault.requestPermission()).toBe('prompt')
  })

  it('is granted once a reachable folder is connected', async () => {
    await connect()
    expect(await vault.permission()).toBe('granted')
  })

  it('reports denied when the folder stops being reachable', async () => {
    await connect()
    bridge.setNotificationsGranted(false)

    expect(await vault.permission()).toBe('denied')
  })

  it('answers requestPermission with the live state, having no prompt to raise', async () => {
    await connect()
    expect(await vault.requestPermission()).toBe('granted')
  })

  it('degrades to denied rather than throwing when the bridge fails', async () => {
    await connect()
    bridge.failNext('vaultPermission', { kind: 'read-failed', message: 'x', path: null })

    expect(await vault.permission()).toBe('denied')
  })

  it('maps an unrecognised permission string to denied', async () => {
    await connect()
    const odd = createTauriVault({ ...bridge, vaultPermission: async () => 'sideways' })
    await odd.connect()

    expect(await odd.permission()).toBe('denied')
  })
})

describe('reading and writing', () => {
  beforeEach(async () => {
    await connect()
  })

  it('reads a file', async () => {
    bridge.seed('notes/a.md', '# A')
    expect(await vault.readFile('notes/a.md')).toBe('# A')
  })

  it('writes a file', async () => {
    await vault.writeFile('notes/a.md', '# A')
    expect(bridge.files.get('notes/a.md')).toBe('# A')
  })

  it('deletes a file', async () => {
    bridge.seed('notes/a.md', '# A')
    await vault.deleteFile('notes/a.md')
    expect(bridge.files.has('notes/a.md')).toBe(false)
  })

  it('reports existence', async () => {
    bridge.seed('notes/a.md', '# A')
    expect(await vault.exists('notes/a.md')).toBe(true)
    expect(await vault.exists('notes/missing.md')).toBe(false)
  })

  it('creates a directory idempotently', async () => {
    await vault.createDirectory('notes/dsa')
    await vault.createDirectory('notes/dsa')
    expect(bridge.directories.has('notes/dsa')).toBe(true)
  })

  it('lists the vault root', async () => {
    bridge.seed('notes/a.md', 'a')
    bridge.seed('README.md', 'r')

    const entries = await vault.listDirectory()
    // `localeCompare` order, which is what the browser adapter produces too —
    // that parity is the point, not the particular order.
    expect(entries).toEqual([
      { name: 'notes', path: 'notes', kind: 'directory' },
      { name: 'README.md', path: 'README.md', kind: 'file' },
    ])
  })

  it('lists a subdirectory with vault-relative paths', async () => {
    bridge.seed('notes/dsa/binary-search.md', 'b')

    expect(await vault.listDirectory('notes/dsa')).toEqual([
      { name: 'binary-search.md', path: 'notes/dsa/binary-search.md', kind: 'file' },
    ])
  })
})

describe('typed errors', () => {
  beforeEach(async () => {
    await connect()
  })

  it('turns a missing file into not-found, keeping the vault-relative path', async () => {
    await expect(vault.readFile('notes/missing.md')).rejects.toMatchObject({
      name: 'VaultError',
      kind: 'not-found',
      path: 'notes/missing.md',
    })
  })

  it('turns a refusal into permission-denied', async () => {
    bridge.failNext('vaultWrite', {
      kind: 'permission-denied',
      message: 'The system refused permission.',
      path: 'notes/a.md',
    })

    await expect(vault.writeFile('notes/a.md', 'x')).rejects.toMatchObject({
      kind: 'permission-denied',
    })
  })

  it('reports operations attempted before connecting as not-connected', async () => {
    const cold = createTauriVault(createFakeTauriBridge({ picks: null }))

    await expect(cold.readFile('notes/a.md')).rejects.toMatchObject({ kind: 'not-connected' })
    await expect(cold.writeFile('notes/a.md', 'x')).rejects.toMatchObject({
      kind: 'not-connected',
    })
  })

  it('does not report a permission failure as absence', async () => {
    // Absence and inaccessibility are different answers: treating the second as
    // the first would let an export overwrite a file it could not see.
    bridge.failNext('vaultExists', {
      kind: 'permission-denied',
      message: 'Refused.',
      path: 'notes/a.md',
    })

    await expect(vault.exists('notes/a.md')).rejects.toMatchObject({
      kind: 'permission-denied',
    })
  })

  it('falls back to a safe kind when the native side sends one it does not know', async () => {
    bridge.failNext('vaultRead', { kind: 'meltdown', message: 'Something odd.', path: null })

    const error = await vault.readFile('notes/a.md').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(VaultError)
    expect((error as VaultError).kind).toBe('read-failed')
  })

  it('never leaks a raw native error to the user', async () => {
    const leaky = createTauriVault({
      ...bridge,
      vaultRead: async () => {
        throw new Error('ENOENT: /Users/someone/Secret Vault/notes/a.md (os error 2)')
      },
    })
    await leaky.connect()

    const error = await leaky.readFile('notes/a.md').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(VaultError)
    expect((error as VaultError).message).not.toContain('/Users/')
    expect((error as VaultError).message).not.toContain('os error')
  })
})

describe('path safety', () => {
  beforeEach(async () => {
    await connect()
  })

  /**
   * Every shape M10 and M11 refuse, still refused now that the sandbox is gone.
   *
   * The browser adapter got a second line of defence for free: the File System
   * Access API resolves one named segment at a time and throws on `..` itself.
   * A native filesystem will follow it without complaint, so on this adapter
   * the check is the *only* thing standing between a bad path and the disk —
   * which is why it is asserted here at length rather than assumed.
   */
  const UNSAFE = [
    '../outside.md',
    '../../outside.md',
    'notes/../../outside.md',
    '/etc/passwd',
    '/Users/someone/notes/a.md',
    'C:/Windows/system32/config.md',
    'C:\\Windows\\a.md',
    '//server/share/a.md',
    'file:///etc/passwd',
    'https://example.com/a.md',
    'notes//a.md',
    'notes/./a.md',
    'notes/%2e%2e/outside.md',
    'notes/a\0.md',
    '',
    '   ',
    'notes/a.txt',
    'notes/a.md.exe',
  ]

  /**
   * `UnsafeVaultPathError`, not `VaultError`, and deliberately so.
   *
   * M10 chose a distinct type because an unsafe path is a *caller* mistake, not
   * a filesystem outcome — collapsing it into `VaultError('invalid-path')`
   * would let it be caught and reported by the same handler that shrugs off a
   * missing file. The desktop adapter keeps that contract rather than inventing
   * a second one; `obsidianService.test.ts` asserts the same thing through the
   * service.
   */
  it.each(UNSAFE)('refuses to read %j, without asking the native side', async (path) => {
    await expect(vault.readFile(path)).rejects.toBeInstanceOf(UnsafeVaultPathError)
    expect(bridge.calls).not.toContain('vaultRead')
  })

  it.each(UNSAFE)('refuses to write to %j, leaving the vault empty', async (path) => {
    await expect(vault.writeFile(path, 'x')).rejects.toBeInstanceOf(UnsafeVaultPathError)
    expect(bridge.calls).not.toContain('vaultWrite')
    expect(bridge.files.size).toBe(0)
  })

  it.each(UNSAFE)('refuses to delete %j', async (path) => {
    await expect(vault.deleteFile(path)).rejects.toBeInstanceOf(UnsafeVaultPathError)
    expect(bridge.calls).not.toContain('vaultDelete')
  })

  it.each(UNSAFE)('refuses to ask whether %j exists', async (path) => {
    await expect(vault.exists(path)).rejects.toBeInstanceOf(UnsafeVaultPathError)
    expect(bridge.calls).not.toContain('vaultExists')
  })

  it('refuses a traversing directory even though it needs no extension', async () => {
    // `createDirectory` cannot demand a `.md` suffix, which is exactly why it
    // needs its own check rather than borrowing the file one.
    for (const path of [
      '../elsewhere',
      'notes/../../elsewhere',
      '/tmp',
      'C:/temp',
      'notes/./x',
      'notes//x',
      'notes/%2e%2e',
    ]) {
      await expect(vault.createDirectory(path)).rejects.toBeInstanceOf(UnsafeVaultPathError)
      await expect(vault.listDirectory(path)).rejects.toBeInstanceOf(UnsafeVaultPathError)
    }
    expect(bridge.calls).not.toContain('vaultCreateDirectory')
    expect(bridge.calls).not.toContain('vaultList')
  })

  it('accepts ordinary vault paths', async () => {
    await expect(vault.writeFile('notes/a.md', 'x')).resolves.toBeUndefined()
    await expect(vault.writeFile('notes/dsa/binary-search.md', 'x')).resolves.toBeUndefined()
    await expect(vault.createDirectory('notes/dsa')).resolves.toBeUndefined()
    await expect(vault.listDirectory()).resolves.toBeInstanceOf(Array)
  })

  it('is refused a second time by the native side even if the adapter were bypassed', async () => {
    // Defence in depth is only real if the inner layer actually refuses. The
    // fake applies the same rules `src-tauri/src/paths.rs` does, so this
    // asserts the contract the Rust unit tests enforce on the other side.
    await expect(bridge.vaultRead('../outside.md')).rejects.toMatchObject({
      kind: 'invalid-path',
    })
    await expect(bridge.vaultWrite('/etc/passwd', 'x')).rejects.toMatchObject({
      kind: 'invalid-path',
    })
  })
})
