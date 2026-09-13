import { beforeEach, describe, expect, it } from 'vitest'
import { UnsafeVaultPathError } from '@/integrations/obsidian/vaultPath'
import type { SyncDecision, SyncPlan } from '@/integrations/obsidian/syncPlan'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { noteRepo, vaultDocumentRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { getNotesView } from './noteQueryService'
import { createNote, updateNote } from './noteService'
import { connectVault, exportNote, scanVault, setVaultPort } from './obsidianService'
import { applySync, scanVaultPlan } from './obsidianSyncService'

/**
 * An existing Obsidian vault becoming Vaultwork notes.
 *
 * The whole path, end to end, with nothing stubbed between the vault adapter
 * and the Notes query: connect → scan → plan → apply → `getNotesView()`. The
 * unit tests around it prove each piece; this proves they are actually joined
 * up, which is the thing that was in doubt and the thing a helper test cannot
 * establish.
 *
 * The vault below is shaped like a real one — files at the root, files in
 * folders, an `.obsidian/` config directory, and attachments that are not
 * notes — because that is where the interesting cases live. Nothing here
 * asserts a count of four: four is what this fixture happens to hold.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)
let vault: MemoryVault

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  vault = createMemoryVault({ name: 'system design contest' })
  setVaultPort(vault)
  await connectVault()
})

/** A vault someone has actually been writing in. */
async function seedVault(): Promise<void> {
  await vault.createDirectory('Java')
  await vault.createDirectory('DSA')
  await vault.createDirectory('.obsidian')
  vault.seed('note1.md', '# Note one\n\nFirst.')
  vault.seed('note2.md', '# Note two\n\nSecond.')
  vault.seed('Java/inheritance.md', '# Inheritance\n\nThird.')
  vault.seed('DSA/recursion.md', '# Recursion\n\nFourth.')
  // Obsidian's own state, and an attachment. Neither is a note.
  vault.seed('.obsidian/workspace.json', '{"main":{}}')
  vault.seed('diagram.png', 'not really a png')
}

const statuses = (plan: SyncPlan) =>
  Object.fromEntries(plan.items.map((item) => [item.key, item.status]))

/** Chooses `decision` for every item in `status`, and skip for the rest. */
const decideAll = (
  plan: SyncPlan,
  status: string,
  decision: SyncDecision,
): Record<string, SyncDecision> =>
  Object.fromEntries(
    plan.items.map((item) => [item.key, item.status === status ? decision : 'skip']),
  )

/** Scan, import everything untracked, and hand back what the vault produced. */
async function importEverything(): Promise<void> {
  const plan = await scanVaultPlan()
  await applySync(plan, decideAll(plan, 'untracked', 'import'))
}

describe('discovering an existing vault', () => {
  beforeEach(seedVault)

  it('finds every Markdown file, including the nested ones', async () => {
    const plan = await scanVaultPlan()

    expect(plan.items.map((item) => item.path).sort()).toEqual([
      'DSA/recursion.md',
      'Java/inheritance.md',
      'note1.md',
      'note2.md',
    ])
    expect(plan.filesSeen).toBe(4)
    // Every one of them is a file with no note behind it.
    expect(plan.items.every((item) => item.status === 'untracked')).toBe(true)
  })

  it('does not stop at the root', async () => {
    await vault.createDirectory('Java/generics')
    vault.seed('Java/generics/wildcards.md', '# Wildcards\n\nDeep.')

    const plan = await scanVaultPlan()
    expect(plan.items.map((item) => item.path)).toContain('Java/generics/wildcards.md')
  })

  it('never opens .obsidian, and counts the attachment it passed over', async () => {
    const plan = await scanVaultPlan()

    expect(plan.items.some((item) => item.path?.includes('.obsidian'))).toBe(false)
    expect(plan.errors).toEqual([])
    expect(plan.skipped.ignoredDirectories).toBe(1)
    // The attachment; `.obsidian/workspace.json` is inside a folder never opened.
    expect(plan.skipped.nonMarkdown).toBe(1)
    expect(plan.skipped.examples).toEqual(['diagram.png'])
  })

  it('reports the same files through the Obsidian page scan', async () => {
    const scan = await scanVault()

    expect(scan.untracked.sort()).toEqual([
      'DSA/recursion.md',
      'Java/inheritance.md',
      'note1.md',
      'note2.md',
    ])
    expect(scan.counts.untracked).toBe(4)
    expect(scan.errors).toEqual([])
  })
})

describe('applying the plan', () => {
  beforeEach(seedVault)

  it('creates a note for each file and the Notes query returns them', async () => {
    const plan = await scanVaultPlan()
    const result = await applySync(plan, decideAll(plan, 'untracked', 'import'))

    expect(result.imported).toBe(4)
    expect(result.failed).toBe(0)

    // The Notes page reads Dexie, not the filesystem. This is that read.
    const view = await getNotesView()
    expect(view.notes).toHaveLength(4)
    expect(view.counts.all).toBe(4)
    expect(view.counts.deleted).toBe(0)
    expect(view.empty).toBe(false)
    expect(view.notes.map((note) => note.title).sort()).toEqual([
      'inheritance',
      'note1',
      'note2',
      'recursion',
    ])
  })

  it('keeps the body, so an imported note is readable', async () => {
    await importEverything()

    const notes = await noteRepo.listLive()
    const first = notes.find((note) => note.title === 'note1' || note.body.includes('First.'))
    expect(first?.body).toContain('First.')
  })

  it('imports only what was chosen', async () => {
    const plan = await scanVaultPlan()
    const one = plan.items.find((item) => item.path === 'note1.md')
    expect(one).toBeDefined()

    const decisions: Record<string, SyncDecision> = {}
    for (const item of plan.items) decisions[item.key] = 'skip'
    decisions[one!.key] = 'import'

    const result = await applySync(plan, decisions)
    expect(result.imported).toBe(1)
    expect((await getNotesView()).notes).toHaveLength(1)
  })

  it('writes nothing at all when everything is skipped', async () => {
    const plan = await scanVaultPlan()
    const result = await applySync(plan, decideAll(plan, 'nothing-matches-this', 'import'))

    expect(result.imported).toBe(0)
    expect((await getNotesView()).notes).toEqual([])
  })
})

describe('scanning again', () => {
  beforeEach(seedVault)

  it('creates no duplicates, however many times it runs', async () => {
    await importEverything()
    expect((await getNotesView()).notes).toHaveLength(4)

    // The bug this guards: a second scan seeing the same files as new.
    for (let round = 0; round < 3; round += 1) {
      const plan = await scanVaultPlan()
      expect(Object.values(statuses(plan)).every((status) => status === 'clean')).toBe(true)
      await applySync(plan, decideAll(plan, 'untracked', 'import'))
    }

    expect((await getNotesView()).notes).toHaveLength(4)
    expect(await noteRepo.listLive()).toHaveLength(4)
  })

  it('sees a file edited in Obsidian as an external change, not as a new note', async () => {
    await importEverything()

    const before = await noteRepo.listLive()
    const note = before.find((row) => row.body.includes('First.'))
    expect(note).toBeDefined()
    vault.seed('note1.md', `${vault.files.get('note1.md') ?? ''}\n\nEdited in Obsidian.`)

    const plan = await scanVaultPlan()
    expect(statuses(plan)[`note:${note!.id}`]).toBe('external-change')
    // No second item claiming the same file.
    expect(plan.items.filter((item) => item.path === 'note1.md')).toHaveLength(1)
    expect((await getNotesView()).notes).toHaveLength(4)
  })

  it('cannot follow a move it has no way to recognise, and says so honestly', async () => {
    /*
     * Move detection works by the Vaultwork id in a file's frontmatter, and an
     * imported file has none — importing deliberately does not rewrite the
     * user's file. So a file moved in Obsidian reads as the old one gone and a
     * new one appearing, which is exactly what Vaultwork can actually observe.
     *
     * Neither half is destructive: nothing is deleted and nothing is merged.
     * This is asserted rather than left implicit because it is the existing
     * semantics and a later change to it should have to break a test.
     */
    await importEverything()

    const note = (await noteRepo.listLive()).find((row) => row.body.includes('First.'))
    const contents = vault.files.get('note1.md') ?? ''
    vault.files.delete('note1.md')
    await vault.createDirectory('Archive')
    vault.seed('Archive/note1.md', contents)

    const plan = await scanVaultPlan()
    expect(statuses(plan)[`note:${note!.id}`]).toBe('missing')
    expect(plan.items.filter((item) => item.status === 'untracked')).toHaveLength(1)
    expect((await getNotesView()).notes).toHaveLength(4)
  })

  it('does follow a move once the file carries the note id', async () => {
    // A note exported from Vaultwork has its id in the file's frontmatter, so
    // the file is authoritative about where it now lives.
    const note = await createNote({ title: 'Ours', body: 'original' })
    await exportNote(note.id)

    const original = note.vaultPath!
    const contents = vault.files.get(original) ?? ''
    vault.files.delete(original)
    await vault.createDirectory('Archive')
    vault.seed('Archive/ours.md', contents)

    const plan = await scanVaultPlan()
    expect(statuses(plan)[`note:${note.id}`]).toBe('moved')
    // Recognised as the same note at a new path — not abandoned and re-found.
    expect(plan.items.find((item) => item.noteId === note.id)?.path).toBe('Archive/ours.md')
    expect(plan.items.some((item) => item.path === 'Archive/ours.md' && item.status === 'untracked')).toBe(
      false,
    )
  })

  it('leaves a file deleted in Obsidian to the existing missing state', async () => {
    await importEverything()

    const note = (await noteRepo.listLive()).find((row) => row.body.includes('First.'))
    vault.files.delete('note1.md')

    const plan = await scanVaultPlan()
    expect(statuses(plan)[`note:${note!.id}`]).toBe('missing')
    // The note is still here. A vault deletion is a decision, not an instruction.
    expect((await getNotesView()).notes).toHaveLength(4)
  })
})

describe('conflict safety', () => {
  beforeEach(seedVault)

  it('reports a conflict and merges nothing when both sides changed', async () => {
    await importEverything()

    const note = (await noteRepo.listLive()).find((row) => row.body.includes('First.'))
    expect(note).toBeDefined()

    await updateNote(note!.id, { body: 'Changed in Vaultwork.' })
    vault.seed('note1.md', `${vault.files.get('note1.md') ?? ''}\n\nChanged in Obsidian.`)

    const plan = await scanVaultPlan()
    expect(statuses(plan)[`note:${note!.id}`]).toBe('conflict')

    // Applying with everything on "skip" — the default — must touch neither side.
    const fileBefore = vault.files.get('note1.md')
    await applySync(plan, Object.fromEntries(plan.items.map((item) => [item.key, 'skip'])))

    expect(vault.files.get('note1.md')).toBe(fileBefore)
    expect((await noteRepo.getOrThrow(note!.id)).body).toBe('Changed in Vaultwork.')
    expect(statuses(await scanVaultPlan())[`note:${note!.id}`]).toBe('conflict')
  })

  it('still refuses to merge a note Vaultwork created and exported', async () => {
    const note = await createNote({ title: 'Ours', body: 'original' })
    await exportNote(note.id)

    await updateNote(note.id, { body: 'ours changed' })
    vault.seed(note.vaultPath!, `${vault.files.get(note.vaultPath!) ?? ''}\n\ntheirs changed`)

    expect(statuses(await scanVaultPlan())[`note:${note.id}`]).toBe('conflict')
  })
})

describe('path safety at the boundary', () => {
  it('refuses to read a path that leaves the vault', async () => {
    await expect(vault.readFile('../outside.md')).rejects.toBeInstanceOf(UnsafeVaultPathError)
    await expect(vault.readFile('/etc/passwd')).rejects.toBeInstanceOf(UnsafeVaultPathError)
  })

  it('records an unsafe entry as an error rather than reading it', async () => {
    /*
     * The walk does not trust the adapter's own listing. A compromised or buggy
     * adapter that hands back `../escape.md` must not get that path read, and
     * the guard has to be at the boundary — not only in the adapter that was
     * the thing that failed.
     */
    vault.seed('ok.md', '# Fine\n')

    const read: string[] = []
    setVaultPort({
      ...vault,
      listDirectory: async (path = '') => {
        const entries = await vault.listDirectory(path)
        return path === ''
          ? [...entries, { name: 'escape.md', path: '../escape.md', kind: 'file' as const }]
          : entries
      },
      readFile: async (path: string) => {
        read.push(path)
        return vault.readFile(path)
      },
    })

    const plan = await scanVaultPlan()

    expect(plan.items.map((item) => item.path)).toEqual(['ok.md'])
    expect(plan.errors).toEqual([{ path: '../escape.md', message: 'Unsafe path; skipped.' }])
    // The important half: it was never opened.
    expect(read).toEqual(['ok.md'])
  })
})

describe('a folder of PDFs', () => {
  /*
   * The folder that started all of this: a vault of scanned PDFs and no
   * Markdown at all. It used to be a dead end — nothing to import, and a screen
   * that could only say so. PDFs are now documents, so the same folder produces
   * three importable rows and no notes.
   */
  beforeEach(() => {
    vault.seedPdf('12e8b18d-970b.pdf', 'Consistent hashing spreads keys across nodes.')
    vault.seedPdf('90e6fc5c-970a.pdf', 'A load balancer distributes requests.')
    vault.seedPdf('3c55181e-970b.pdf', 'CAP theorem: consistency, availability, partitions.')
  })

  it('discovers them as documents rather than passing them over', async () => {
    const plan = await scanVaultPlan()

    expect(plan.seen).toEqual({ markdown: 0, pdf: 3 })
    expect(plan.skipped.nonMarkdown).toBe(0)
    expect(plan.errors).toEqual([])
    expect(plan.items.every((item) => item.itemKind === 'document')).toBe(true)
    expect(plan.items.every((item) => item.status === 'untracked')).toBe(true)
  })

  it('imports them as documents and not as notes', async () => {
    const plan = await scanVaultPlan()
    const result = await applySync(plan, decideAll(plan, 'untracked', 'import'))

    expect(result.imported).toBe(3)
    // The Notes page reads notes. A PDF is not one, and must never appear there.
    expect((await getNotesView()).notes).toEqual([])
    expect(await vaultDocumentRepo.listLive()).toHaveLength(3)
  })

  it('still says nothing was found when the folder really holds neither', async () => {
    await resetDatabase()
    freezeClock(NOW)
    vault = createMemoryVault({ name: 'empty' })
    setVaultPort(vault)
    await connectVault()
    vault.seed('photo.png', 'binary')
    vault.seed('archive.zip', 'binary')

    const plan = await scanVaultPlan()
    expect(plan.seen).toEqual({ markdown: 0, pdf: 0 })
    expect(plan.skipped.nonMarkdown).toBe(2)
    expect(plan.items).toEqual([])
  })
})
