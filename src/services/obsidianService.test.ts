import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { parseNoteFile } from '@/integrations/obsidian/noteFile'
import { UnsafeVaultPathError } from '@/integrations/obsidian/vaultPath'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { VaultError } from '@/platform'
import { noteRepo, tagRepo, vaultLinkRepo } from '@/repositories'
import { tagInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { getNotesView } from './noteQueryService'
import { createNote, deleteNote, updateNote } from './noteService'
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
  resolveNoteWikilinks,
  scanVault,
  serializeNoteForVault,
  setVaultPort,
} from './obsidianService'

/**
 * The Obsidian service, driven by an in-memory vault.
 *
 * That the service can be driven this way *is* the architecture test for the
 * adapter boundary: nothing below `VaultPort` is real here, and the service
 * cannot tell. A Tauri adapter will substitute the same way.
 *
 * The load-bearing family is safety — every case where a write would destroy
 * something the user has not seen must refuse to write.
 */

const NOW = new Date(2026, 8, 5, 10, 0, 0)

let vault: MemoryVault

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  vault = createMemoryVault({ name: 'TestVault' })
  setVaultPort(vault)
})

const connect = () => connectVault()

const eventTypes = async () =>
  (await db.events.toArray()).sort((a, b) => a.at - b.at).map((event) => event.type)

describe('connection', () => {
  it('starts disconnected and says notes still work', async () => {
    const status = await getVaultStatus()
    expect(status.state).toBe('not-connected')
    expect(status.message).toContain('Notes work normally')
  })

  it('connects and reports the vault name', async () => {
    const status = await connect()
    expect(status).toMatchObject({ state: 'connected', vaultName: 'TestVault' })
  })

  it('reports permission-required rather than claiming to be connected', async () => {
    await connect()
    // A handle can outlive its permission; the status must reflect the
    // permission, not the handle.
    vault.setPermission('prompt')
    expect((await getVaultStatus()).state).toBe('permission-required')

    vault.setPermission('denied')
    expect((await getVaultStatus()).state).toBe('permission-denied')
  })

  it('reports an unsupported browser plainly', async () => {
    setVaultPort(createMemoryVault({ supported: false }))
    const status = await getVaultStatus()
    expect(status.state).toBe('unsupported')
    expect(status.message).toContain('not supported in this browser')
  })

  it('forgets the baselines on disconnect', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await exportNote(note.id)
    expect(await vaultLinkRepo.listLive()).toHaveLength(1)

    await disconnectVault()

    // Reconnecting to a *different* folder must not compare against hashes
    // recorded from the old one.
    expect(await vaultLinkRepo.listLive()).toHaveLength(0)
    expect((await getVaultStatus()).state).toBe('not-connected')
  })

  it('emits connect and disconnect exactly once each', async () => {
    await connect()
    await disconnectVault()
    expect(await eventTypes()).toEqual(['obsidian.connected', 'obsidian.disconnected'])
  })

  it('refuses every operation while disconnected', async () => {
    const note = await createNote({ title: 'A note' })
    await expect(exportNote(note.id)).rejects.toThrow(VaultError)
    await expect(scanVault()).rejects.toThrow(/Connect an Obsidian vault/)
  })
})

describe('export', () => {
  it('writes a note to its vault path', async () => {
    await connect()
    const note = await createNote({ title: 'Binary Search', body: '# Halve it\n' })

    const result = await exportNote(note.id)

    expect(result).toMatchObject({ written: true, vaultPath: 'notes/binary-search.md' })
    expect(vault.files.get('notes/binary-search.md')).toContain('# Halve it')
  })

  it('creates the parent directories first', async () => {
    await connect()
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    const note = await createNote({ title: 'Trees', tagIds: [tag.id] })

    await exportNote(note.id)

    // The memory vault refuses a write into a folder that does not exist, so
    // this passing means the directories were genuinely created.
    expect(vault.directories.has('notes')).toBe(true)
    expect(vault.directories.has('notes/dsa')).toBe(true)
    expect(vault.files.has('notes/dsa/trees.md')).toBe(true)
  })

  it('creating a directory twice is not an error', async () => {
    await connect()
    const a = await createNote({ title: 'One' })
    const b = await createNote({ title: 'Two' })
    await exportNote(a.id)
    await expect(exportNote(b.id)).resolves.toMatchObject({ written: true })
  })

  it('writes frontmatter carrying the note id', async () => {
    await connect()
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    const note = await createNote({ title: 'Binary Search', tagIds: [tag.id] })
    await exportNote(note.id)

    const parsed = parseNoteFile(vault.files.get('notes/dsa/binary-search.md') as string)
    expect(parsed.id).toBe(note.id)
    expect(parsed.title).toBe('Binary Search')
    expect(parsed.tags).toEqual(['dsa'])
  })

  it('records a baseline so the next comparison has an ancestor', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await exportNote(note.id)

    const link = await vaultLinkRepo.forEntity('note', note.id)
    expect(link).toMatchObject({ path: 'notes/a-note.md', entityType: 'note' })
    // The baseline records the *projection*, not the raw bytes — see
    // `comparableContent` for why comparing bytes produces false conflicts.
    expect(link?.lastHashFile).toBe(link?.lastHashApp)
    expect(link?.syncedAt).toBeGreaterThanOrEqual(NOW.getTime())
  })

  it('re-exporting an unchanged note is clean and harmless', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await exportNote(note.id)

    expect((await getNoteSyncReport(note.id)).status).toBe('clean')
    await expect(exportNote(note.id)).resolves.toMatchObject({ written: true })
  })

  it('exports a local change over an untouched file', async () => {
    await connect()
    const note = await createNote({ title: 'A note', body: 'first' })
    await exportNote(note.id)

    await updateNote(note.id, { body: 'second' })
    expect((await getNoteSyncReport(note.id)).status).toBe('local-change')

    await exportNote(note.id)
    expect(vault.files.get('notes/a-note.md')).toContain('second')
  })

  it('REFUSES to overwrite a file that changed externally', async () => {
    await connect()
    const note = await createNote({ title: 'A note', body: 'ours' })
    await exportNote(note.id)

    // Somebody edited it in Obsidian.
    vault.seed('notes/a-note.md', 'theirs, written by hand\n')

    const result = await exportNote(note.id)

    expect(result.written).toBe(false)
    expect(result.status).toBe('external-change')
    // The external edit survived untouched — this is the whole milestone.
    expect(vault.files.get('notes/a-note.md')).toBe('theirs, written by hand\n')
  })

  it('REFUSES to overwrite when both sides changed', async () => {
    await connect()
    const note = await createNote({ title: 'A note', body: 'base' })
    await exportNote(note.id)

    await updateNote(note.id, { body: 'ours' })
    vault.seed('notes/a-note.md', 'theirs\n')

    const result = await exportNote(note.id)
    expect(result.status).toBe('conflict')
    expect(result.written).toBe(false)
    expect(vault.files.get('notes/a-note.md')).toBe('theirs\n')
  })

  it('refuses to overwrite a pre-existing file it never wrote', async () => {
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/a-note.md', 'written in Obsidian first\n')

    const note = await createNote({ title: 'A note' })
    const result = await exportNote(note.id)

    expect(result.written).toBe(false)
    expect(vault.files.get('notes/a-note.md')).toBe('written in Obsidian first\n')
  })

  it('overwrites only when the user explicitly says so', async () => {
    await connect()
    const note = await createNote({ title: 'A note', body: 'ours' })
    await exportNote(note.id)
    vault.seed('notes/a-note.md', 'theirs\n')

    const result = await exportNote(note.id, { overwriteExternalChanges: true })

    expect(result.written).toBe(true)
    expect(vault.files.get('notes/a-note.md')).toContain('ours')
  })

  it('emits a conflict event when it refuses, and an export event when it writes', async () => {
    await connect()
    const note = await createNote({ title: 'A note', body: 'ours' })
    await exportNote(note.id)
    vault.seed('notes/a-note.md', 'theirs\n')
    await exportNote(note.id)

    const types = await eventTypes()
    expect(types).toContain('note.exported')
    expect(types).toContain('note.syncConflict')
  })

  it('rejects an unsafe vault path before touching the filesystem', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await noteRepo.update(note.id, { vaultPath: '../../escape.md' }, { emit: false })

    await expect(exportNote(note.id)).rejects.toThrow(UnsafeVaultPathError)
    expect(vault.files.size).toBe(0)
  })

  it('turns a permission failure into a readable error', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    vault.setPermission('denied')

    await expect(exportNote(note.id)).rejects.toThrow(/denied/i)
  })

  it('reports a write failure rather than recording a baseline', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    vault.failNext('write', new VaultError('write-failed', 'disk full'))

    await expect(exportNote(note.id)).rejects.toThrow(/disk full/)
    // Nothing was written, so nothing may claim to have been synced.
    expect(await vaultLinkRepo.forEntity('note', note.id)).toBeUndefined()
  })
})

describe('bulk export', () => {
  it('exports every live note and skips deleted ones', async () => {
    await connect()
    await createNote({ title: 'One' })
    await createNote({ title: 'Two' })
    const gone = await createNote({ title: 'Deleted' })
    await deleteNote(gone.id)

    const result = await exportAllNotes()

    expect(result.exported).toHaveLength(2)
    expect(vault.files.has('notes/deleted.md')).toBe(false)
  })

  it('skips conflicts instead of overwriting them', async () => {
    await connect()
    const safe = await createNote({ title: 'Safe' })
    const risky = await createNote({ title: 'Risky', body: 'ours' })
    await exportNote(risky.id)
    vault.seed('notes/risky.md', 'theirs\n')

    const result = await exportAllNotes()

    expect(result.exported.map((row) => row.noteId)).toContain(safe.id)
    expect(result.skipped.map((row) => row.noteId)).toContain(risky.id)
    expect(vault.files.get('notes/risky.md')).toBe('theirs\n')
  })

  it('never deletes a vault file that has no note behind it', async () => {
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/theirs.md', 'written in Obsidian\n')
    await createNote({ title: 'Ours' })

    await exportAllNotes()

    // Export is additive. Somebody else's file is not ours to remove.
    expect(vault.files.get('notes/theirs.md')).toBe('written in Obsidian\n')
  })

  it('one bad note does not abort the rest', async () => {
    await connect()
    const broken = await createNote({ title: 'Broken' })
    await noteRepo.update(broken.id, { vaultPath: '../escape.md' }, { emit: false })
    await createNote({ title: 'Fine' })

    const result = await exportAllNotes()

    expect(result.failed).toHaveLength(1)
    expect(result.exported.map((row) => row.vaultPath)).toContain('notes/fine.md')
  })
})

describe('import', () => {
  const file = (id: string | null, title: string, body: string) =>
    [
      '---',
      ...(id === null ? [] : [`id: "${id}"`]),
      `title: ${title}`,
      'tags:',
      '  - imported',
      'aliases:',
      '  - Another name',
      '---',
      '',
      body,
      '',
    ].join('\n')

  it('previews without changing anything', async () => {
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/from-vault.md', file(null, 'From Vault', 'body text'))

    const preview = await previewImport('notes/from-vault.md')

    expect(preview).toMatchObject({
      path: 'notes/from-vault.md',
      title: 'From Vault',
      fileNoteId: null,
      existingNoteId: null,
      wouldOverwrite: false,
    })
    expect(await noteRepo.listLive()).toHaveLength(0)
  })

  it('creates a new note when the file carries no Vaultwork id', async () => {
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/from-vault.md', file(null, 'From Vault', 'body text'))

    const result = await importNote('notes/from-vault.md')

    expect(result.created).toBe(true)
    const note = await noteRepo.getOrThrow(result.noteId)
    expect(note.title).toBe('From Vault')
    expect(note.body).toContain('body text')
    // It keeps the file's own path rather than moving the user's file.
    expect(note.vaultPath).toBe('notes/from-vault.md')
  })

  it('generates an id for a file that has none', async () => {
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/plain.md', '# Just markdown\n\nNo frontmatter at all.\n')

    const result = await importNote('notes/plain.md')
    const note = await noteRepo.getOrThrow(result.noteId)

    expect(note.id).toMatch(/[0-9a-f-]{16,}/)
    expect(note.body).toContain('No frontmatter at all')
  })

  it('falls back to the filename as the title', async () => {
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/binary-search.md', 'no frontmatter here\n')

    const result = await importNote('notes/binary-search.md')
    expect((await noteRepo.getOrThrow(result.noteId)).title).toBe('binary-search')
  })

  it('updates the matching note when the id is recognised', async () => {
    await connect()
    const note = await createNote({ title: 'Original', body: 'original body' })
    await exportNote(note.id)

    vault.seed('notes/original.md', file(note.id, 'Renamed In Obsidian', 'edited body'))

    const result = await importNote('notes/original.md')

    expect(result.created).toBe(false)
    expect(result.noteId).toBe(note.id)
    const updated = await noteRepo.getOrThrow(note.id)
    expect(updated.title).toBe('Renamed In Obsidian')
    expect(updated.body).toContain('edited body')
  })

  it('preserves the id across a round trip', async () => {
    await connect()
    const note = await createNote({ title: 'Round Trip' })
    await exportNote(note.id)
    const result = await importNote('notes/round-trip.md')

    expect(result.noteId).toBe(note.id)
    expect(await noteRepo.listLive()).toHaveLength(1)
  })

  it('REFUSES to replace local changes without confirmation', async () => {
    await connect()
    const note = await createNote({ title: 'A note', body: 'exported' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'local edit not yet exported' })

    const preview = await previewImport('notes/a-note.md')
    expect(preview.wouldOverwrite).toBe(true)

    await expect(importNote('notes/a-note.md')).rejects.toThrow(/local changes/)
    expect((await noteRepo.getOrThrow(note.id)).body).toContain('local edit')
  })

  it('replaces local changes when the user confirms', async () => {
    await connect()
    const note = await createNote({ title: 'A note', body: 'exported' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'local edit' })

    await importNote('notes/a-note.md', { overwriteLocalChanges: true })

    expect((await noteRepo.getOrThrow(note.id)).body).toContain('exported')
  })

  it('tells the preview what it is about to affect', async () => {
    await connect()
    const note = await createNote({ title: 'Existing' })
    await exportNote(note.id)

    const preview = await previewImport('notes/existing.md')
    expect(preview.existingNoteId).toBe(note.id)
    expect(preview.existingTitle).toBe('Existing')
  })

  it('reads a malformed file as body text rather than failing', async () => {
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/broken.md', '---\n:::nonsense\n[unclosed\n---\n\nreal body\n')

    const result = await importNote('notes/broken.md')
    expect((await noteRepo.getOrThrow(result.noteId)).body).toContain('real body')
  })

  it('rejects an unsafe path', async () => {
    await connect()
    await expect(previewImport('../../etc/passwd.md')).rejects.toThrow(UnsafeVaultPathError)
  })

  it('emits one import event', async () => {
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/x.md', 'body\n')
    await importNote('notes/x.md')

    expect((await eventTypes()).filter((type) => type === 'note.imported')).toHaveLength(1)
  })
})

describe('unknown frontmatter survives a round trip', () => {
  it('keeps keys Vaultwork does not understand when re-exporting', async () => {
    await connect()
    await vault.createDirectory('notes')
    vault.seed(
      'notes/theirs.md',
      ['---', 'aliases:', '  - Other', 'cssclasses: wide', 'publish: true', '---', '', 'body', ''].join(
        '\n',
      ),
    )

    const imported = await importNote('notes/theirs.md')
    await updateNote(imported.noteId, { body: 'edited in Vaultwork' })
    await exportNote(imported.noteId)

    const written = vault.files.get('notes/theirs.md') as string
    expect(written).toContain('aliases:')
    expect(written).toContain('  - Other')
    expect(written).toContain('cssclasses: wide')
    expect(written).toContain('publish: true')
    expect(written).toContain('edited in Vaultwork')
  })
})

describe('the comparison projection', () => {
  it('does not call an external edit a conflict just because it changed both sides', async () => {
    // Regression: `serializeNoteForVault` preserves the file's own unknown
    // frontmatter, so the bytes Vaultwork would write depend on the file. If
    // the comparison used those bytes, an external edit would move the local
    // side too and every external change would read as a conflict.
    await connect()
    const note = await createNote({ title: 'A note', body: 'ours' })
    await exportNote(note.id)

    vault.seed(
      'notes/a-note.md',
      ['---', `id: "${note.id}"`, 'title: A note', 'aliases:', '  - Added in Obsidian', '---', '', 'edited', ''].join('\n'),
    )

    expect((await getNoteSyncReport(note.id)).status).toBe('external-change')
  })

  it('ignores a change to the user own frontmatter alone', async () => {
    await connect()
    const note = await createNote({ title: 'A note', body: 'body' })
    await exportNote(note.id)

    const original = vault.files.get('notes/a-note.md') as string
    // Only an alias was added; the note's content is untouched.
    vault.seed('notes/a-note.md', original.replace('---\n\n', 'aliases:\n  - Extra\n---\n\n'))

    expect((await getNoteSyncReport(note.id)).status).toBe('clean')
  })

  it('ignores line-ending differences', async () => {
    await connect()
    const note = await createNote({ title: 'A note', body: 'line one\nline two' })
    await exportNote(note.id)

    const original = vault.files.get('notes/a-note.md') as string
    vault.seed('notes/a-note.md', original.replace(/\n/g, '\r\n'))

    expect((await getNoteSyncReport(note.id)).status).toBe('clean')
  })
})

describe('rename', () => {
  it('writes the destination, then removes the source', async () => {
    await connect()
    const note = await createNote({ title: 'Before' })
    await exportNote(note.id)

    const result = await renameVaultFile(note.id, 'notes/dsa/after.md')

    expect(result.partial).toBe(false)
    expect(vault.files.has('notes/dsa/after.md')).toBe(true)
    expect(vault.files.has('notes/before.md')).toBe(false)
    expect((await noteRepo.getOrThrow(note.id)).vaultPath).toBe('notes/dsa/after.md')
  })

  it('preserves the content', async () => {
    await connect()
    const note = await createNote({ title: 'Before', body: '# Kept\n' })
    await exportNote(note.id)
    await renameVaultFile(note.id, 'notes/after.md')

    expect(vault.files.get('notes/after.md')).toContain('# Kept')
  })

  it('refuses when the destination already exists', async () => {
    await connect()
    const note = await createNote({ title: 'Before' })
    const other = await createNote({ title: 'Taken' })
    await exportNote(note.id)
    await exportNote(other.id)

    await expect(renameVaultFile(note.id, 'notes/taken.md')).rejects.toThrow(/already exists/)
    // Nothing moved.
    expect(vault.files.has('notes/before.md')).toBe(true)
    expect((await noteRepo.getOrThrow(note.id)).vaultPath).toBe('notes/before.md')
  })

  it('reports a partial rename when the old file cannot be removed', async () => {
    await connect()
    const note = await createNote({ title: 'Before' })
    await exportNote(note.id)

    vault.failNext('delete', new VaultError('permission-denied', 'locked'))
    const result = await renameVaultFile(note.id, 'notes/after.md')

    // A filesystem is not a transaction. Both files exist, and Vaultwork says
    // so rather than pretending the move completed.
    expect(result.partial).toBe(true)
    expect(result.message).toContain('both files now exist')
    expect(vault.files.has('notes/after.md')).toBe(true)
    expect(vault.files.has('notes/before.md')).toBe(true)
  })

  it('leaves the original alone when the destination write fails', async () => {
    await connect()
    const note = await createNote({ title: 'Before' })
    await exportNote(note.id)

    vault.failNext('write', new VaultError('write-failed', 'disk full'))
    await expect(renameVaultFile(note.id, 'notes/after.md')).rejects.toThrow(/disk full/)

    expect(vault.files.has('notes/before.md')).toBe(true)
    // The path must not move if the file did not.
    expect((await noteRepo.getOrThrow(note.id)).vaultPath).toBe('notes/before.md')
  })

  it('renames a note that was never exported', async () => {
    await connect()
    const note = await createNote({ title: 'Never exported' })
    const result = await renameVaultFile(note.id, 'notes/moved.md')

    expect(result.partial).toBe(false)
    expect(vault.files.has('notes/moved.md')).toBe(true)
  })

  it('rejects an unsafe destination', async () => {
    await connect()
    const note = await createNote({ title: 'Before' })
    await expect(renameVaultFile(note.id, '../escape.md')).rejects.toThrow(UnsafeVaultPathError)
  })

  it('updates the baseline so the next comparison is clean', async () => {
    await connect()
    const note = await createNote({ title: 'Before' })
    await exportNote(note.id)
    await renameVaultFile(note.id, 'notes/after.md')

    const link = await vaultLinkRepo.forEntity('note', note.id)
    expect(link?.path).toBe('notes/after.md')
    expect((await getNoteSyncReport(note.id)).status).toBe('clean')
  })

  it('emits a rename event carrying both paths', async () => {
    await connect()
    const note = await createNote({ title: 'Before' })
    await exportNote(note.id)
    await renameVaultFile(note.id, 'notes/after.md')

    const event = (await db.events.toArray()).find(
      (row) => row.type === 'note.vaultPathRenamed',
    )
    expect(event?.payload).toMatchObject({ from: 'notes/before.md', to: 'notes/after.md' })
  })
})

describe('delete from the vault', () => {
  it('is never triggered by deleting the note itself', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await exportNote(note.id)

    await deleteNote(note.id)

    // Deleting a Vaultwork note is a decision about Vaultwork. The user's file
    // in their own vault is a separate decision.
    expect(vault.files.has('notes/a-note.md')).toBe(true)
  })

  it('deletes an unchanged file on explicit request', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await exportNote(note.id)

    const result = await deleteFromVault(note.id)

    expect(result.deleted).toBe(true)
    expect(vault.files.has('notes/a-note.md')).toBe(false)
    expect(await vaultLinkRepo.forEntity('note', note.id)).toBeUndefined()
  })

  it('REFUSES to delete a file that changed externally', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await exportNote(note.id)
    vault.seed('notes/a-note.md', 'edited in Obsidian\n')

    const result = await deleteFromVault(note.id)

    expect(result.deleted).toBe(false)
    expect(result.message).toContain('changed in Obsidian')
    expect(vault.files.get('notes/a-note.md')).toBe('edited in Obsidian\n')
  })

  it('deletes a changed file only when forced', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await exportNote(note.id)
    vault.seed('notes/a-note.md', 'edited\n')

    const result = await deleteFromVault(note.id, { force: true })
    expect(result.deleted).toBe(true)
  })

  it('handles a file that is already gone', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await exportNote(note.id)
    vault.files.delete('notes/a-note.md')

    const result = await deleteFromVault(note.id)
    expect(result.deleted).toBe(false)
    expect(result.message).toContain('not in the vault')
  })
})

describe('scanning', () => {
  it('classifies every note and finds untracked files', async () => {
    await connect()
    const clean = await createNote({ title: 'Clean' })
    await exportNote(clean.id)

    const local = await createNote({ title: 'Local', body: 'a' })
    await exportNote(local.id)
    await updateNote(local.id, { body: 'b' })

    const external = await createNote({ title: 'External' })
    await exportNote(external.id)
    vault.seed('notes/external.md', 'changed by hand\n')

    await createNote({ title: 'Never' })
    vault.seed('notes/theirs.md', 'not ours\n')

    const scan = await scanVault()

    expect(scan.counts.clean).toBe(1)
    expect(scan.counts['local-change']).toBe(1)
    expect(scan.counts['external-change']).toBe(1)
    expect(scan.counts['not-exported']).toBe(1)
    expect(scan.untracked).toContain('notes/theirs.md')
  })

  it('writes nothing and emits nothing', async () => {
    await connect()
    const note = await createNote({ title: 'A note' })
    await exportNote(note.id)

    const before = new Set((await db.events.toArray()).map((row) => row.id))
    const files = new Map(vault.files)

    await scanVault()

    const added = (await db.events.toArray()).filter((row) => !before.has(row.id))
    expect(added).toEqual([])
    expect([...vault.files.entries()]).toEqual([...files.entries()])
  })

  it('ignores dot-folders such as .obsidian', async () => {
    await connect()
    await vault.createDirectory('.obsidian')
    vault.seed('.obsidian/config.md', 'not a note\n')

    const scan = await scanVault()
    expect(scan.untracked).not.toContain('.obsidian/config.md')
  })
})

describe('wikilinks', () => {
  it('resolves a link to another note by title', async () => {
    const target = await createNote({ title: 'Binary Search' })
    const source = await createNote({ title: 'Index', body: 'See [[Binary Search]].' })

    const links = await resolveNoteWikilinks(source.id)
    expect(links).toEqual([
      { target: 'Binary Search', status: 'resolved', noteId: target.id, title: 'Binary Search' },
    ])
  })

  it('leaves an unknown target unresolved and creates nothing', async () => {
    const source = await createNote({ title: 'Index', body: 'See [[Never Written]].' })

    const links = await resolveNoteWikilinks(source.id)
    expect(links[0]).toMatchObject({ status: 'unresolved', noteId: null })
    // No ghost note appeared.
    expect(await noteRepo.listLive()).toHaveLength(1)
  })

  it('never turns a wikilink into a noteLinks row', async () => {
    const target = await createNote({ title: 'Binary Search' })
    const source = await createNote({ title: 'Index', body: '[[Binary Search]]' })
    await resolveNoteWikilinks(source.id)

    // `noteLinks` is the canonical relationship system and its rows come from
    // an explicit user action, never from prose.
    expect(await db.noteLinks.count()).toBe(0)
    expect(target.id).not.toBe(source.id)
  })

  it('does not resolve a note to itself', async () => {
    const note = await createNote({ title: 'Self', body: 'See [[Self]].' })
    expect((await resolveNoteWikilinks(note.id))[0]?.status).toBe('unresolved')
  })
})

describe('serialization through the service', () => {
  it('resolves tag ids to names for the file', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    const note = await createNote({ title: 'Tagged', tagIds: [tag.id] })

    const file = await serializeNoteForVault(await noteRepo.getOrThrow(note.id))
    expect(file).toContain('  - dsa')
  })

  it('is stable, so an unchanged note stays clean', async () => {
    await connect()
    const note = await createNote({ title: 'Stable' })
    const first = await serializeNoteForVault(await noteRepo.getOrThrow(note.id))
    const second = await serializeNoteForVault(await noteRepo.getOrThrow(note.id))
    expect(first).toBe(second)
  })
})

/**
 * The "connected vault shows 0 files" regression.
 *
 * The scan used to `return` on any listing failure, so a vault it could not
 * open reported exactly what an empty vault reports. The user saw "0 files"
 * for a folder they knew held four, with nothing to act on and no way to tell
 * the two situations apart.
 */
describe('scanning a vault that really has files', () => {
  /** Four ordinary Markdown files, one of them nested. */
  const seedFourFiles = () => {
    vault.seed('Welcome.md', '# Welcome\n\nFirst note.')
    vault.seed('Daily/2026-09-06.md', '# Today\n\nSecond note.')
    vault.seed('Projects/DSA.md', '# DSA\n\nThird note.')
    vault.seed('Ideas.md', '# Ideas\n\nFourth note.')
  }

  it('finds all four, none of them tracked yet', async () => {
    await connect()
    seedFourFiles()

    const scan = await scanVault()

    expect(scan.untracked.sort()).toEqual([
      'Daily/2026-09-06.md',
      'Ideas.md',
      'Projects/DSA.md',
      'Welcome.md',
    ])
    expect(scan.counts.untracked).toBe(4)
    expect(scan.errors).toEqual([])
  })

  it('still ignores dot-folders and non-Markdown files', async () => {
    await connect()
    seedFourFiles()
    vault.seed('.obsidian/workspace.json', '{}')
    vault.seed('attachment.png', 'binary')

    const scan = await scanVault()

    expect(scan.counts.untracked).toBe(4)
    expect(scan.untracked.some((path) => path.includes('.obsidian'))).toBe(false)
    expect(scan.untracked.some((path) => path.endsWith('.png'))).toBe(false)
  })

  it('reports a folder it could not read instead of counting it as empty', async () => {
    await connect()
    seedFourFiles()
    vault.seed('Locked/secret.md', '# Secret')
    // One folder refuses. The other three files must still be found, and the
    // failure must be visible rather than silently shrinking the count.
    vault.failListing('Locked', new VaultError('read-failed', 'Locked folder.'))

    const scan = await scanVault()

    expect(scan.errors).toHaveLength(1)
    expect(scan.errors[0]?.path).toBe('Locked')
    expect(scan.counts.untracked).toBe(4)
  })

  it('refuses the whole scan when the vault root cannot be read', async () => {
    // The real-world case: connected, but the OS will not hand over the folder.
    // Reporting "0 files" here is the bug; an error is the truth.
    await connect()
    seedFourFiles()
    vault.failListing('', new VaultError('permission-denied', 'Permission denied.'))

    await expect(scanVault()).rejects.toThrow(/Permission denied/)
  })
})

/**
 * The whole route a vault file takes to become a Vaultwork note.
 *
 * Written because "my Obsidian notes are not in Vaultwork" turned out to have
 * three separate possible causes — the scan finding nothing, the import never
 * being run, and the two builds using different databases — and only one of
 * them was a bug. This pins the part that is supposed to work, so the next
 * time the answer is "the pipeline is fine, something upstream is not".
 *
 * Note what it does *not* do: connecting imports nothing. Every note below
 * exists because `importNote` was called explicitly, which is M10/M11's design
 * and the reason a vault can be attached without anything being touched.
 */
describe('four vault files becoming four notes', () => {
  const FILES: Record<string, string> = {
    'Welcome.md': '# Welcome\n\nFirst note.',
    'Daily/2026-09-06.md': '# Today\n\nSecond note.',
    'Projects/DSA.md': '# DSA\n\nThird note.',
    'Ideas.md': '# Ideas\n\nFourth note.',
  }

  beforeEach(async () => {
    await connect()
    for (const [path, contents] of Object.entries(FILES)) vault.seed(path, contents)
  })

  it('imports nothing merely by connecting', async () => {
    // The safety property first: a vault is attached, not absorbed.
    const view = await getNotesView()
    expect(view.notes).toHaveLength(0)
  })

  it('scans, previews, imports, and the Notes query returns all four', async () => {
    const scan = await scanVault()
    expect(scan.untracked).toHaveLength(4)

    // Each file previews as a new note before anything is written.
    for (const path of scan.untracked) {
      const preview = await previewImport(path)
      expect(preview.status).toBe('untracked')
    }
    expect((await getNotesView()).notes).toHaveLength(0)

    for (const path of scan.untracked) await importNote(path)

    const view = await getNotesView()
    expect(view.notes).toHaveLength(4)
    // Titles come from the *filename*, not the first heading — which is how
    // Obsidian itself identifies a note, and why the daily note is called
    // "2026-09-06" rather than "Today".
    expect(view.notes.map((item) => item.note.title).sort()).toEqual([
      '2026-09-06',
      'DSA',
      'Ideas',
      'Welcome',
    ])
  })

  it('leaves nothing untracked once imported, and re-scans clean', async () => {
    const first = await scanVault()
    for (const path of first.untracked) await importNote(path)

    const second = await scanVault()
    expect(second.untracked).toEqual([])
    expect(second.counts.untracked).toBe(0)
    expect(second.reports).toHaveLength(4)
    expect(second.errors).toEqual([])
  })

  it('keeps each note pointing at the file it came from', async () => {
    const scan = await scanVault()
    for (const path of scan.untracked) await importNote(path)

    const paths = (await noteRepo.listLive()).map((note) => note.vaultPath).sort()
    expect(paths).toEqual(Object.keys(FILES).sort())
  })
})
