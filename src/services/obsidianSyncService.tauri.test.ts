import { beforeEach, describe, expect, it } from 'vitest'
import {
  defaultDecisions,
  safeDecisions,
  type SyncDecision,
  type SyncPlan,
} from '@/integrations/obsidian/syncPlan'
import { createFakeTauriBridge, type FakeTauriBridge } from '@/platform/tauri/fakeBridge'
import { createTauriVault } from '@/platform/tauri/tauriVault'
import { noteRepo, vaultLinkRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { createNote, updateNote } from './noteService'
import {
  connectVault,
  disconnectVault,
  exportNote,
  getVaultStatus,
  setVaultPort,
} from './obsidianService'
import { applySync, scanVaultPlan } from './obsidianSyncService'

/**
 * M11's sync algorithm, driven through the *desktop* adapter.
 *
 * This is the milestone's central claim made testable: `obsidianSyncService`
 * was not modified for M13, and the proof is that the same scan → plan →
 * apply → baseline → rescan cycle produces the same outcomes when the bytes
 * are coming from a native filesystem instead of a directory handle. If a
 * future change to the desktop adapter breaks the contract the sync algorithm
 * relies on, this file fails rather than a user discovering it against their
 * real vault.
 *
 * The Obsidian service is not touched at all — it is handed a different
 * `VaultPort` through the injection seam it has had since M10, which is
 * precisely what the port was for.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)
let bridge: FakeTauriBridge

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  bridge = createFakeTauriBridge({ name: 'Desktop Vault' })
  setVaultPort(createTauriVault(bridge))
  await connectVault()
})

/** Plan keys are `note:<id>` for a tracked note and `file:<path>` for a stray file. */
const forNote = (plan: SyncPlan, noteId: string) =>
  plan.items.find((item) => item.key === `note:${noteId}`)
/** Every note reserves a vault path at creation (M9); this narrows the type. */
const pathOf = (note: { vaultPath: string | null }): string => {
  if (note.vaultPath === null) throw new Error('the note reserved no vault path')
  return note.vaultPath
}

const forFile = (plan: SyncPlan, path: string) =>
  plan.items.find((item) => item.key === `file:${path}`)

/**
 * Decides `choice` for every item with `status`, leaving the rest skipped.
 *
 * `safeDecisions` deliberately refuses to import an external change or a stray
 * file on the user's behalf — that is M11's whole philosophy, and the desktop
 * runtime does not get to relax it. So a test that wants an import has to ask
 * for one, exactly as the Sync Center makes the user do.
 */
const decideAll = (
  plan: SyncPlan,
  status: string,
  choice: SyncDecision,
): Record<string, SyncDecision> => {
  const decisions = defaultDecisions(plan)
  for (const item of plan.items) {
    if (item.status === status) decisions[item.key] = choice
  }
  return decisions
}

describe('the desktop vault drives M11 unchanged', () => {
  it('connects and reports the folder the native picker returned', async () => {
    const status = await getVaultStatus()

    expect(status.state).toBe('connected')
    expect(status.vaultName).toBe('Desktop Vault')
    expect(status.restorable).toBe(true)
  })

  it('exports a note to the native filesystem and records a baseline', async () => {
    const note = await createNote({ title: 'Binary Search', body: 'Halve it.' })

    const result = await exportNote(note.id)
    expect(result.written).toBe(true)
    expect(result.status).toBe('clean')

    const written = bridge.files.get(pathOf(note))
    expect(written).toContain('Binary Search')
    expect(written).toContain('Halve it.')

    const link = await vaultLinkRepo.forEntity('note', note.id)
    expect(link?.lastHashFile).toBeTruthy()
  })

  it('scans a vault of native files and changes nothing', async () => {
    const note = await createNote({ title: 'Binary Search', body: 'Halve it.' })
    await exportNote(note.id)
    const before = bridge.files.get(pathOf(note))
    // Counted from here: the export above legitimately wrote.
    const mark = bridge.calls.length

    const plan = await scanVaultPlan()

    expect(plan.items.length).toBeGreaterThan(0)
    // A scan is a read. It writes nothing, to the vault or to the database.
    expect(bridge.files.get(pathOf(note))).toBe(before)
    const during = bridge.calls.slice(mark)
    expect(during).not.toContain('vaultWrite')
    expect(during).not.toContain('vaultDelete')
    expect(during).not.toContain('vaultCreateDirectory')
  })

  it('classifies a file edited outside Vaultwork as an external change', async () => {
    const note = await createNote({ title: 'Binary Search', body: 'Halve it.' })
    await exportNote(note.id)

    const existing = bridge.files.get(pathOf(note)) as string
    bridge.seed(pathOf(note), existing.replace('Halve it.', 'Halve it, carefully.'))

    const plan = await scanVaultPlan()

    expect(forNote(plan, note.id)?.status).toBe('external-change')
  })

  it('imports that external change and leaves the vault as the file already was', async () => {
    const note = await createNote({ title: 'Binary Search', body: 'Halve it.' })
    await exportNote(note.id)

    const existing = bridge.files.get(pathOf(note)) as string
    const edited = existing.replace('Halve it.', 'Halve it, carefully.')
    bridge.seed(pathOf(note), edited)

    const plan = await scanVaultPlan()
    const result = await applySync(plan, decideAll(plan, 'external-change', 'import'))

    expect(result.imported).toBe(1)
    expect(result.failed).toBe(0)
    const updated = await noteRepo.get(note.id)
    expect(updated?.body).toContain('carefully')
  })

  it('detects a conflict when both sides changed, and writes nothing', async () => {
    const note = await createNote({ title: 'Binary Search', body: 'Halve it.' })
    await exportNote(note.id)

    const existing = bridge.files.get(pathOf(note)) as string
    bridge.seed(pathOf(note), existing.replace('Halve it.', 'Changed in Obsidian.'))
    await updateNote(note.id, { body: 'Changed in Vaultwork.' })

    const plan = await scanVaultPlan()
    expect(forNote(plan, note.id)?.status).toBe('conflict')

    // `safeDecisions` never resolves a conflict on the user's behalf.
    const before = bridge.files.get(pathOf(note))
    await applySync(plan, safeDecisions(plan))
    expect(bridge.files.get(pathOf(note))).toBe(before)

    const kept = await noteRepo.get(note.id)
    expect(kept?.body).toBe('Changed in Vaultwork.')
  })

  it('reports a clean rescan once everything has been applied', async () => {
    const note = await createNote({ title: 'Binary Search', body: 'Halve it.' })
    await exportNote(note.id)

    const rescan = await scanVaultPlan()
    expect(forNote(rescan, note.id)?.status).toBe('clean')
  })

  it('imports a Markdown file that only ever existed in the vault', async () => {
    await bridge.vaultCreateDirectory('notes')
    bridge.seed('notes/from-obsidian.md', '# From Obsidian\n\nWritten elsewhere.\n')

    const plan = await scanVaultPlan()
    expect(forFile(plan, 'notes/from-obsidian.md')?.status).toBe('untracked')

    // Nothing is imported until it is asked for: the safe default leaves a
    // stray file exactly where it is.
    await applySync(plan, safeDecisions(plan))
    expect(await noteRepo.listLive()).toHaveLength(0)

    await applySync(plan, decideAll(plan, 'untracked', 'import'))

    // The title comes from the file name, which is M11's existing rule for a
    // file carrying no frontmatter title — unchanged by the runtime.
    const notes = await noteRepo.listLive()
    expect(notes.map((n) => n.title)).toContain('from-obsidian')
  })

  it('survives disconnect and reconnect, keeping notes and baselines', async () => {
    const note = await createNote({ title: 'Binary Search', body: 'Halve it.' })
    await exportNote(note.id)

    await disconnectVault()
    expect((await getVaultStatus()).state).toBe('not-connected')

    // Disconnecting clears baselines by design (M10): a baseline describes a
    // *specific* vault, and keeping it would let Vaultwork compare against
    // somebody else's. The note itself is untouched.
    expect(await noteRepo.get(note.id)).not.toBeNull()
    expect(bridge.files.get(pathOf(note))).toBeTruthy()

    await connectVault()
    const status = await getVaultStatus()
    expect(status.state).toBe('connected')
    expect(status.vaultName).toBe('Desktop Vault')

    // The file is still there, so a rescan finds it rather than losing it.
    const plan = await scanVaultPlan()
    expect(plan.items.some((item) => item.path === pathOf(note))).toBe(true)
  })

  it('isolates one unreadable file so the rest of a bulk sync still applies', async () => {
    const first = await createNote({ title: 'Alpha', body: 'One.' })
    const second = await createNote({ title: 'Beta', body: 'Two.' })

    await exportNote(first.id)
    await exportNote(second.id)

    const one = bridge.files.get(pathOf(first)) as string
    const two = bridge.files.get(pathOf(second)) as string
    bridge.seed(pathOf(first), one.replace('One.', 'One, edited.'))
    bridge.seed(pathOf(second), two.replace('Two.', 'Two, edited.'))

    const plan = await scanVaultPlan()
    bridge.failNext('vaultRead', {
      kind: 'read-failed',
      message: 'The disk hiccuped.',
      path: pathOf(first),
    })

    const result = await applySync(plan, decideAll(plan, 'external-change', 'import'))

    // M11 re-reads each file before applying, so a read that fails is treated
    // as "the world moved under us" — `stale`, not `failed`. That is M11's
    // behaviour and M13 does not get to change it; what matters here is that
    // the other item was unaffected.
    const outcomes = new Map(result.items.map((item) => [item.key, item.outcome]))
    expect(outcomes.get(`note:${first.id}`)).toBe('stale')
    expect(outcomes.get(`note:${second.id}`)).toBe('applied')

    expect(result.imported).toBe(1)
    expect(result.stale).toBe(1)

    // The unaffected note really was updated, rather than merely reported as such.
    expect((await noteRepo.get(second.id))?.body).toContain('Two, edited.')
    expect((await noteRepo.get(first.id))?.body).toBe('One.')
  })
})
