import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { safeDecisions, type SyncDecision, type SyncPlan } from '@/integrations/obsidian/syncPlan'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { VaultError } from '@/platform'
import { noteRepo, vaultLinkRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { createNote, deleteNote, updateNote } from './noteService'
import { connectVault, exportNote, setVaultPort } from './obsidianService'
import {
  applySync,
  describeSyncResult,
  scanVaultPlan,
  VaultUnavailableError,
} from './obsidianSyncService'

/**
 * The bidirectional sync workflow, against an in-memory vault.
 *
 * The families that matter: scanning must change nothing, applying must
 * re-check the filesystem first, and a bulk run must give every item an
 * independent fate — one failure never costs the others their baseline.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)
let vault: MemoryVault

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  vault = createMemoryVault({ name: 'TestVault' })
  setVaultPort(vault)
  await connectVault()
})

const seed = async (path: string, contents: string) => {
  await vault.createDirectory(path.split('/').slice(0, -1).join('/'))
  vault.seed(path, contents)
}

const itemFor = (plan: SyncPlan, key: string) => plan.items.find((item) => item.key === key)

const decide = (
  plan: SyncPlan,
  choices: Record<string, SyncDecision>,
): Record<string, SyncDecision> => {
  const decisions: Record<string, SyncDecision> = {}
  for (const item of plan.items) decisions[item.key] = choices[item.key] ?? 'skip'
  return decisions
}

describe('scanning changes nothing', () => {
  it('writes no file, no note, no baseline and no event', async () => {
    const note = await createNote({ title: 'A note', body: 'ours' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'edited' })
    await seed('notes/theirs.md', '# Theirs\n')

    const beforeFiles = new Map(vault.files)
    const beforeNotes = await noteRepo.listLive()
    const beforeLinks = await vaultLinkRepo.listLive()
    const beforeEvents = new Set((await db.events.toArray()).map((row) => row.id))

    await scanVaultPlan()

    expect([...vault.files.entries()]).toEqual([...beforeFiles.entries()])
    expect(await noteRepo.listLive()).toEqual(beforeNotes)
    expect(await vaultLinkRepo.listLive()).toEqual(beforeLinks)
    const added = (await db.events.toArray()).filter((row) => !beforeEvents.has(row.id))
    expect(added).toEqual([])
  })

  it('refuses when the vault is unavailable', async () => {
    vault.setPermission('denied')
    await expect(scanVaultPlan()).rejects.toThrow(VaultUnavailableError)
  })
})

describe('classification against a real vault', () => {
  it('finds every state at once', async () => {
    const clean = await createNote({ title: 'Clean' })
    await exportNote(clean.id)

    const local = await createNote({ title: 'Local', body: 'a' })
    await exportNote(local.id)
    await updateNote(local.id, { body: 'b' })

    const external = await createNote({ title: 'External' })
    await exportNote(external.id)
    vault.seed('notes/external.md', 'changed by hand\n')

    const contested = await createNote({ title: 'Contested', body: 'base' })
    await exportNote(contested.id)
    await updateNote(contested.id, { body: 'ours' })
    vault.seed('notes/contested.md', 'theirs\n')

    const gone = await createNote({ title: 'Gone' })
    await exportNote(gone.id)
    vault.files.delete('notes/gone.md')

    const moved = await createNote({ title: 'Moved' })
    await exportNote(moved.id)
    const body = vault.files.get('notes/moved.md') as string
    vault.files.delete('notes/moved.md')
    await seed('notes/archive/moved.md', body)

    await createNote({ title: 'Never' })
    await seed('notes/theirs.md', '# Written in Obsidian\n')

    const plan = await scanVaultPlan()

    expect(itemFor(plan, `note:${clean.id}`)?.status).toBe('clean')
    expect(itemFor(plan, `note:${local.id}`)?.status).toBe('local-change')
    expect(itemFor(plan, `note:${external.id}`)?.status).toBe('external-change')
    expect(itemFor(plan, `note:${contested.id}`)?.status).toBe('conflict')
    expect(itemFor(plan, `note:${gone.id}`)?.status).toBe('missing')
    expect(itemFor(plan, `note:${moved.id}`)?.status).toBe('moved')
    expect(plan.counts['not-exported']).toBe(1)
    expect(plan.counts.untracked).toBe(1)
  })

  it('ignores dot-folders and non-Markdown files', async () => {
    await seed('.obsidian/workspace.md', 'config\n')
    await seed('notes/image.png', 'binary\n')
    await seed('notes/drawing.canvas', '{}\n')
    await seed('notes/real.md', '# Real\n')

    const plan = await scanVaultPlan()

    expect(plan.filesSeen).toBe(1)
    expect(plan.items.map((item) => item.path)).toEqual(['notes/real.md'])
  })

  it('records an unreadable file as an error and carries on', async () => {
    await seed('notes/good.md', '# Good\n')
    await seed('notes/bad.md', '# Bad\n')
    vault.failNext('read', new VaultError('read-failed', 'unreadable'))

    const plan = await scanVaultPlan()

    expect(plan.errors).toHaveLength(1)
    expect(plan.counts.error).toBe(1)
    // The other file was still classified.
    expect(plan.items.some((item) => item.status === 'untracked')).toBe(true)
  })

  it('reports a note deleted here whose file remains', async () => {
    const note = await createNote({ title: 'Doomed' })
    await exportNote(note.id)
    await deleteNote(note.id)

    const plan = await scanVaultPlan()
    expect(itemFor(plan, `note:${note.id}`)?.status).toBe('deleted-local')
    expect(vault.files.has('notes/doomed.md')).toBe(true)
  })

  it('reports two files claiming one note', async () => {
    const note = await createNote({ title: 'Original' })
    await exportNote(note.id)
    await seed('notes/copy.md', vault.files.get('notes/original.md') as string)

    const plan = await scanVaultPlan()
    expect(plan.counts['duplicate-id']).toBe(1)
    // Neither file was touched.
    expect(vault.files.has('notes/original.md')).toBe(true)
    expect(vault.files.has('notes/copy.md')).toBe(true)
  })
})

describe('applying decisions', () => {
  it('does nothing for items left on skip', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    const plan = await scanVaultPlan()
    const result = await applySync(plan, decide(plan, {}))

    expect(result.exported).toBe(0)
    expect(vault.files.get('notes/a-note.md')).toContain('a')
  })

  it('exports a local change and updates the baseline', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    const plan = await scanVaultPlan()
    const result = await applySync(plan, safeDecisions(plan))

    expect(result.exported).toBe(1)
    expect(vault.files.get('notes/a-note.md')).toContain('b')
    // And the next scan is clean.
    expect(itemFor(await scanVaultPlan(), `note:${note.id}`)?.status).toBe('clean')
  })

  it('imports an external change without touching the file', async () => {
    const note = await createNote({ title: 'A note', body: 'ours' })
    await exportNote(note.id)
    vault.seed('notes/a-note.md', `---\nid: "${note.id}"\ntitle: A note\n---\n\ntheirs\n`)

    const plan = await scanVaultPlan()
    const result = await applySync(plan, decide(plan, { [`note:${note.id}`]: 'import' }))

    expect(result.imported).toBe(1)
    expect((await noteRepo.getOrThrow(note.id)).body).toContain('theirs')
    expect(vault.files.get('notes/a-note.md')).toContain('theirs')
  })

  it('imports a new file as a new note keeping its own path', async () => {
    await seed('notes/deep/theirs.md', '---\ntitle: Theirs\n---\n\nhand written\n')

    const plan = await scanVaultPlan()
    const result = await applySync(plan, decide(plan, { 'file:notes/deep/theirs.md': 'import' }))

    expect(result.imported).toBe(1)
    const [created] = await noteRepo.listLive()
    expect(created).toMatchObject({ title: 'Theirs', vaultPath: 'notes/deep/theirs.md' })
    expect(created?.body).toContain('hand written')
  })

  it('resolves a conflict by keeping Vaultwork', async () => {
    const note = await createNote({ title: 'A note', body: 'base' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'ours' })
    vault.seed('notes/a-note.md', 'theirs\n')

    const plan = await scanVaultPlan()
    await applySync(plan, decide(plan, { [`note:${note.id}`]: 'keep-local' }))

    expect(vault.files.get('notes/a-note.md')).toContain('ours')
    expect((await noteRepo.getOrThrow(note.id)).body).toBe('ours')
  })

  it('resolves a conflict by keeping Obsidian', async () => {
    const note = await createNote({ title: 'A note', body: 'base' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'ours' })
    vault.seed('notes/a-note.md', `---\nid: "${note.id}"\ntitle: A note\n---\n\ntheirs\n`)

    const plan = await scanVaultPlan()
    await applySync(plan, decide(plan, { [`note:${note.id}`]: 'keep-external' }))

    expect((await noteRepo.getOrThrow(note.id)).body).toContain('theirs')
  })

  it('accepts a move without writing or deleting a file', async () => {
    const note = await createNote({ title: 'Moved' })
    await exportNote(note.id)
    const body = vault.files.get('notes/moved.md') as string
    vault.files.delete('notes/moved.md')
    await seed('notes/archive/moved.md', body)

    const plan = await scanVaultPlan()
    const before = new Map(vault.files)
    const result = await applySync(plan, decide(plan, { [`note:${note.id}`]: 'accept-move' }))

    expect(result.moved).toBe(1)
    expect((await noteRepo.getOrThrow(note.id)).vaultPath).toBe('notes/archive/moved.md')
    // Only Vaultwork's record moved; the vault is untouched.
    expect([...vault.files.entries()]).toEqual([...before.entries()])
    expect(itemFor(await scanVaultPlan(), `note:${note.id}`)?.status).toBe('clean')
  })

  it('writes a missing file again on request', async () => {
    const note = await createNote({ title: 'Gone' })
    await exportNote(note.id)
    vault.files.delete('notes/gone.md')

    const plan = await scanVaultPlan()
    await applySync(plan, decide(plan, { [`note:${note.id}`]: 'restore-to-vault' }))

    expect(vault.files.has('notes/gone.md')).toBe(true)
  })

  it('forgets a link without deleting the note or the file', async () => {
    const note = await createNote({ title: 'Gone' })
    await exportNote(note.id)
    vault.files.delete('notes/gone.md')

    const plan = await scanVaultPlan()
    const result = await applySync(plan, decide(plan, { [`note:${note.id}`]: 'forget-link' }))

    expect(result.forgotten).toBe(1)
    expect(await noteRepo.get(note.id)).toBeDefined()
    expect(await vaultLinkRepo.forEntity('note', note.id)).toBeUndefined()
  })

  it('deletes a vault file only for a note deleted here, on request', async () => {
    const note = await createNote({ title: 'Doomed' })
    await exportNote(note.id)
    await deleteNote(note.id)

    const plan = await scanVaultPlan()
    // Nothing happened just because the note was deleted.
    expect(vault.files.has('notes/doomed.md')).toBe(true)

    const result = await applySync(plan, decide(plan, { [`note:${note.id}`]: 'delete-from-vault' }))
    expect(result.deleted).toBe(1)
    expect(vault.files.has('notes/doomed.md')).toBe(false)
  })
})

describe('stale plans', () => {
  it('refuses to export when the file changed after the scan', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    const plan = await scanVaultPlan()
    // Somebody saved in Obsidian while the user was reading the plan.
    vault.seed('notes/a-note.md', 'written after the scan\n')

    const result = await applySync(plan, safeDecisions(plan))

    expect(result.stale).toBe(1)
    expect(result.exported).toBe(0)
    expect(result.items[0]?.message).toContain('changed since the scan')
    // The newer file survived.
    expect(vault.files.get('notes/a-note.md')).toBe('written after the scan\n')
  })

  it('refuses to import when the file changed after the scan', async () => {
    await seed('notes/theirs.md', '# First\n')
    const plan = await scanVaultPlan()
    vault.seed('notes/theirs.md', '# Second\n')

    const result = await applySync(plan, decide(plan, { 'file:notes/theirs.md': 'import' }))

    expect(result.stale).toBe(1)
    expect(await noteRepo.listLive()).toHaveLength(0)
  })

  it('refuses to delete when the file changed after the scan', async () => {
    const note = await createNote({ title: 'Doomed' })
    await exportNote(note.id)
    await deleteNote(note.id)

    const plan = await scanVaultPlan()
    vault.seed('notes/doomed.md', 'edited after the scan\n')

    const result = await applySync(plan, decide(plan, { [`note:${note.id}`]: 'delete-from-vault' }))

    expect(result.stale).toBe(1)
    expect(vault.files.get('notes/doomed.md')).toBe('edited after the scan\n')
  })

  it('lets a forget-link through, since it touches no file', async () => {
    const note = await createNote({ title: 'Gone' })
    await exportNote(note.id)
    vault.files.delete('notes/gone.md')

    const plan = await scanVaultPlan()
    const result = await applySync(plan, decide(plan, { [`note:${note.id}`]: 'forget-link' }))
    expect(result.forgotten).toBe(1)
  })
})

describe('baselines', () => {
  it('records one only after a successful operation', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    const before = await vaultLinkRepo.forEntity('note', note.id)

    await updateNote(note.id, { body: 'b' })
    const plan = await scanVaultPlan()
    await applySync(plan, safeDecisions(plan))

    const after = await vaultLinkRepo.forEntity('note', note.id)
    expect(after?.lastHashFile).not.toBe(before?.lastHashFile)
  })

  it('leaves the baseline alone when an item is skipped', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    const before = await vaultLinkRepo.forEntity('note', note.id)

    await updateNote(note.id, { body: 'b' })
    const plan = await scanVaultPlan()
    await applySync(plan, decide(plan, {}))

    expect(await vaultLinkRepo.forEntity('note', note.id)).toEqual(before)
  })

  it('leaves the baseline alone when an item goes stale', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    const before = await vaultLinkRepo.forEntity('note', note.id)

    await updateNote(note.id, { body: 'b' })
    const plan = await scanVaultPlan()
    vault.seed('notes/a-note.md', 'moved on\n')
    await applySync(plan, safeDecisions(plan))

    expect(await vaultLinkRepo.forEntity('note', note.id)).toEqual(before)
  })

  it('leaves the baseline alone when a write fails', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    const before = await vaultLinkRepo.forEntity('note', note.id)

    await updateNote(note.id, { body: 'b' })
    const plan = await scanVaultPlan()
    vault.failNext('write', new VaultError('write-failed', 'disk full'))
    const result = await applySync(plan, safeDecisions(plan))

    expect(result.failed).toBe(1)
    expect(await vaultLinkRepo.forEntity('note', note.id)).toEqual(before)
  })

  it('never records a baseline for a conflict left unresolved', async () => {
    const note = await createNote({ title: 'A note', body: 'base' })
    await exportNote(note.id)
    const before = await vaultLinkRepo.forEntity('note', note.id)

    await updateNote(note.id, { body: 'ours' })
    vault.seed('notes/a-note.md', 'theirs\n')
    const plan = await scanVaultPlan()
    await applySync(plan, decide(plan, {}))

    expect(await vaultLinkRepo.forEntity('note', note.id)).toEqual(before)
  })
})

describe('bulk operations', () => {
  it('gives every item an independent fate', async () => {
    const good = await createNote({ title: 'Good', body: 'a' })
    const bad = await createNote({ title: 'Bad', body: 'a' })
    await exportNote(good.id)
    await exportNote(bad.id)
    await updateNote(good.id, { body: 'b' })
    await updateNote(bad.id, { body: 'b' })

    const plan = await scanVaultPlan()
    // The first write in the batch fails; the second must still happen.
    vault.failNext('write', new VaultError('write-failed', 'disk full'))
    const result = await applySync(plan, safeDecisions(plan))

    expect(result.failed).toBe(1)
    expect(result.exported).toBe(1)
    expect(result.items).toHaveLength(2)
  })

  it('imports ten new files, and one bad file does not abort the batch', async () => {
    for (let i = 0; i < 10; i += 1) {
      await seed(`notes/bulk/file-${i}.md`, `---\ntitle: File ${i}\n---\n\nbody ${i}\n`)
    }

    const plan = await scanVaultPlan()
    const decisions: Record<string, SyncDecision> = {}
    for (const item of plan.items) decisions[item.key] = 'import'

    // One read fails partway through.
    vault.failNext('read', new VaultError('read-failed', 'unreadable'))
    const result = await applySync(plan, decisions)

    expect(result.imported + result.failed + result.stale).toBe(10)
    expect(result.imported).toBeGreaterThan(0)
    expect(await noteRepo.listLive()).toHaveLength(result.imported)
  })

  it('reports what actually happened rather than claiming success', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    const plan = await scanVaultPlan()
    const result = await applySync(plan, safeDecisions(plan))

    expect(describeSyncResult(result)).toContain('1 exported')
    expect(describeSyncResult(EMPTY())).toBe('Nothing to do')
  })

  const EMPTY = () => ({
    imported: 0,
    exported: 0,
    moved: 0,
    deleted: 0,
    forgotten: 0,
    skipped: 0,
    stale: 0,
    failed: 0,
    items: [],
    finishedAt: 0,
  })

  it('refuses to start when permission is already gone', async () => {
    const note = await createNote({ title: 'One', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    const plan = await scanVaultPlan()
    vault.setPermission('denied')

    // Refusing outright is better than half-applying a batch.
    await expect(applySync(plan, safeDecisions(plan))).rejects.toThrow(VaultUnavailableError)
    expect(vault.files.get('notes/one.md')).toContain('a')
  })

  it('stops the batch when permission is revoked partway through', async () => {
    for (const title of ['One', 'Two', 'Three']) {
      const note = await createNote({ title, body: 'a' })
      await exportNote(note.id)
      await updateNote(note.id, { body: 'b' })
    }

    const plan = await scanVaultPlan()
    // Revoked after the first file is written, as a user might in the OS.
    vault.afterWrite = () => {
      vault.afterWrite = null
      vault.setPermission('denied')
    }

    const result = await applySync(plan, safeDecisions(plan))

    // One got through; the rest stop rather than grinding through a wall of
    // identical failures.
    expect(result.exported).toBe(1)
    expect(result.items[result.items.length - 1]?.message).toMatch(/denied/i)
    expect(result.items.length).toBeLessThan(4)
  })
})

describe('events', () => {
  it('emits one per successful mutation and none for a skip', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })
    await seed('notes/theirs.md', '# Theirs\n')

    const plan = await scanVaultPlan()
    const before = new Set((await db.events.toArray()).map((row) => row.id))

    await applySync(
      plan,
      decide(plan, {
        [`note:${note.id}`]: 'export',
        'file:notes/theirs.md': 'import',
      }),
    )

    const added = (await db.events.toArray()).filter((row) => !before.has(row.id))
    const types = added.map((row) => row.type).sort()
    expect(types).toContain('note.exported')
    expect(types).toContain('note.imported')
    expect(types.filter((type) => type === 'note.exported')).toHaveLength(1)
  })

  it('does not pretend an export edited the note', async () => {
    const note = await createNote({ title: 'A note', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })
    const noteBefore = await noteRepo.getOrThrow(note.id)

    const plan = await scanVaultPlan()
    const before = new Set((await db.events.toArray()).map((row) => row.id))
    await applySync(plan, safeDecisions(plan))

    const added = (await db.events.toArray()).filter((row) => !before.has(row.id))
    // Writing a file is not a content edit; `updatedAt` must not move.
    expect(added.map((row) => row.type)).toEqual(['note.exported'])
    expect((await noteRepo.getOrThrow(note.id)).updatedAt).toBe(noteBefore.updatedAt)
  })
})
