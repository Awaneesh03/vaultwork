import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { parseNoteFile } from '@/integrations/obsidian/noteFile'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { noteRepo, vaultDocumentRepo } from '@/repositories'
import {
  connectVault,
  createResearchPack,
  createNote,
  exportNote,
  getBacklinks,
  importNote,
  scanVault,
  setVaultPort,
} from '@/services'
import { createProject } from '@/services/projectService'
import { execute } from '@/services/commands/commandExecutor'
import type { Note } from '@/types/entities'
import { freezeClock, resetDatabase } from './helpers'

/**
 * M18.2 end to end: a knowledge artifact is created through the command layer,
 * written to Obsidian through the existing conflict-safe export, shown on the
 * entity it belongs to, and bundled into a research pack — all against real
 * IndexedDB semantics and an in-memory vault behind the real `VaultPort`.
 */

const NOW = new Date('2026-09-21T09:30:00.000Z')
let vault: MemoryVault

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  vault = createMemoryVault({ name: 'TestVault' })
  setVaultPort(vault)
})

/** Adds a note the way every producer does: an intent, through the executor. */
async function addNote(fields: {
  title: string
  body?: string
  projectId?: string
  knowledgeKind?: Note['kind'] | string
  provenance?: unknown
}): Promise<Note> {
  const result = await execute({
    kind: 'note.add',
    source: 'ui',
    raw: '',
    title: fields.title,
    body: fields.body ?? '',
    tagIds: [],
    links: fields.projectId === undefined ? [] : [{ refType: 'project', refId: fields.projectId }],
    knowledgeKind: fields.knowledgeKind as Note['kind'],
    provenance: fields.provenance as Note['provenance'],
  })
  if (result.status !== 'ok' || result.kind !== 'note') {
    throw new Error(`note.add failed: ${result.status}`)
  }
  return result.note
}

describe('creating a knowledge artifact', () => {
  it('scaffolds an empty artifact with its sections and a wikilink to the project', async () => {
    const project = await createProject('Vaultwork')
    const note = await addNote({
      title: 'Database migration',
      projectId: project.id,
      knowledgeKind: 'decision',
    })

    expect(note.kind).toBe('decision')
    expect(note.body).toContain('## Context')
    expect(note.body).toContain('## Consequences')
    expect(note.body).toContain('- [[Vaultwork]]')
  })

  it('records the user as the source when no provenance was given', async () => {
    const note = await addNote({ title: 'Review', knowledgeKind: 'review' })
    expect(note.provenance).toEqual({
      source: 'user',
      sourceId: null,
      sourceUrl: null,
      capturedAt: null,
    })
  })

  it('never replaces a body the user typed', async () => {
    const note = await addNote({ title: 'Brief', body: 'Already written.', knowledgeKind: 'brief' })
    expect(note.body).toBe('Already written.')
  })

  it('leaves an ordinary note ordinary', async () => {
    const note = await addNote({ title: 'Plain', body: 'hello' })
    expect(note.kind).toBeNull()
    expect(note.provenance).toBeNull()
    expect(note.body).toBe('hello')
  })

  it('treats an unknown kind from any producer as an ordinary note', async () => {
    const note = await addNote({ title: 'Odd', knowledgeKind: 'manifesto' })
    expect(note.kind).toBeNull()
    expect(note.body).toBe('')
  })

  it('stores a sanitised provenance, never the credential that came with it', async () => {
    const note = await addNote({
      title: 'From an email',
      knowledgeKind: 'research',
      provenance: {
        source: 'email',
        sourceId: 'msg-1',
        sourceUrl: 'https://mail.example.com/m/1?access_token=SECRET123&view=full',
        capturedAt: NOW.getTime(),
      },
    })

    expect(note.provenance?.sourceUrl).toBe('https://mail.example.com/m/1?view=full')
    const stored = JSON.stringify(await noteRepo.get(note.id))
    expect(stored).not.toContain('SECRET123')
  })
})

describe('artifacts in Obsidian', () => {
  it('exports provenance as namespaced frontmatter through the existing export', async () => {
    await connectVault()
    const note = await addNote({ title: 'Use Dexie', knowledgeKind: 'decision' })

    const result = await exportNote(note.id)
    expect(result.written).toBe(true)
    expect(result.status).toBe('clean')

    const file = vault.files.get(note.vaultPath as string) as string
    expect(file).toContain('vaultwork-kind: decision')
    expect(file).toContain('vaultwork-source: user')
    expect(parseNoteFile(file).kind).toBe('decision')
  })

  it('still refuses to overwrite an external edit to an artifact', async () => {
    await connectVault()
    const note = await addNote({ title: 'Use Dexie', knowledgeKind: 'decision' })
    await exportNote(note.id)

    vault.seed(note.vaultPath as string, 'rewritten by hand in Obsidian\n')
    const again = await exportNote(note.id)

    expect(again.status).toBe('external-change')
    expect(vault.files.get(note.vaultPath as string)).toBe('rewritten by hand in Obsidian\n')
  })

  it('keeps an imported artifact faithful: its kind, its provenance, no headings added', async () => {
    await connectVault()
    vault.seed(
      'inbox/meeting.md',
      [
        '---',
        'title: Standup',
        'vaultwork-kind: meeting',
        'vaultwork-source: calendar',
        'vaultwork-source-id: "evt-9"',
        '---',
        '',
        '',
      ].join('\n'),
    )

    const { noteId } = await importNote('inbox/meeting.md')
    const note = await noteRepo.getOrThrow(noteId)

    expect(note.kind).toBe('meeting')
    expect(note.provenance).toMatchObject({ source: 'calendar', sourceId: 'evt-9' })
    expect(note.body).not.toContain('## Attendees')
  })

  it('shows the Obsidian file on the entity only once one actually exists', async () => {
    await connectVault()
    const project = await createProject('Vaultwork')
    const note = await addNote({
      title: 'Project brief',
      projectId: project.id,
      knowledgeKind: 'brief',
    })

    const before = await getBacklinks('project', project.id)
    expect(before[0]).toMatchObject({ noteId: note.id, kind: 'brief', obsidianPath: null })

    await exportNote(note.id)
    const after = await getBacklinks('project', project.id)
    expect(after[0]?.obsidianPath).toBe(note.vaultPath)
  })

  it('leaves an ordinary exported note clean and free of knowledge keys', async () => {
    await connectVault()
    const note = await createNote({ title: 'Plain', body: 'hello' })
    await exportNote(note.id)

    expect(vault.files.get(note.vaultPath as string)).not.toContain('vaultwork-')
    const scan = await scanVault()
    expect(scan.reports.find((report) => report.noteId === note.id)?.status).toBe('clean')
  })
})

describe('research packs', () => {
  async function projectWithKnowledge() {
    const project = await createProject('DSA Mastery')
    await vaultDocumentRepo.create({
      title: 'System Design',
      vaultPath: 'papers/System Design.pdf',
      kind: 'pdf',
      text: 'Partitioning is the first idea.',
      extraction: 'ok',
      chars: 30,
      bytes: 1024,
      hash: 'h1',
      importedAt: NOW.getTime(),
    })
    await addNote({
      title: 'Trees',
      body: 'See [[System Design.pdf]] for the partitioning chapter.',
      projectId: project.id,
      knowledgeKind: 'research',
      provenance: {
        source: 'web',
        sourceUrl: 'https://example.com/trees?api_key=LEAKED&ch=3',
      },
    })
    await addNote({ title: 'Loose thought', body: 'unrelated' })
    return project
  }

  it('refuses without a connected vault', async () => {
    const project = await projectWithKnowledge()
    await expect(createResearchPack(project.id)).rejects.toThrow(/Connect an Obsidian vault/)
    expect([...vault.files.keys()].some((path) => path.startsWith('.vaultwork'))).toBe(false)
  })

  it("writes the project's notes and cited PDFs into the hidden pack folder", async () => {
    await connectVault()
    const project = await projectWithKnowledge()

    const result = await createResearchPack(project.id)

    expect(result.folder).toBe('.vaultwork/research-packs/dsa-mastery-20260921-0930')
    expect(result.notes).toBe(1)
    expect(result.documents).toEqual([
      { title: 'System Design', vaultPath: 'papers/System Design.pdf' },
    ])

    const written = [...vault.files.keys()].filter((path) => path.startsWith(result.folder))
    expect(written.sort()).toEqual([`${result.folder}/01-trees.md`, `${result.folder}/README.md`])

    // Only this project's notes: the unlinked one stays out.
    const everything = written.map((path) => vault.files.get(path)).join('\n')
    expect(everything).toContain('partitioning chapter')
    expect(everything).not.toContain('unrelated')
    expect(everything).toContain('papers/System Design.pdf')
  })

  it('never overwrites an earlier pack', async () => {
    await connectVault()
    const project = await projectWithKnowledge()

    const first = await createResearchPack(project.id)
    const firstReadme = vault.files.get(`${first.folder}/README.md`)
    const second = await createResearchPack(project.id)

    expect(second.folder).toBe(`${first.folder}-2`)
    expect(vault.files.get(`${first.folder}/README.md`)).toBe(firstReadme)
  })

  it('is invisible to the vault scan, so a pack is never offered for import', async () => {
    await connectVault()
    const project = await projectWithKnowledge()
    await createResearchPack(project.id)

    const scan = await scanVault()
    expect(scan.untracked.filter((path) => path.startsWith('.vaultwork'))).toEqual([])
    expect(scan.counts['duplicate-id']).toBe(0)
  })

  it('carries no credential into any pack file', async () => {
    await connectVault()
    const project = await projectWithKnowledge()
    const result = await createResearchPack(project.id)

    for (const [path, contents] of vault.files) {
      if (!path.startsWith(result.folder)) continue
      expect(contents, path).not.toContain('LEAKED')
      expect(contents, path).not.toMatch(/api_key|access_token/)
    }
  })

  it('records that a pack was made, in the event log', async () => {
    await connectVault()
    const project = await projectWithKnowledge()
    await createResearchPack(project.id)

    const events = await db.events.where('type').equals('knowledge.pack_created').toArray()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ entityType: 'project', entityId: project.id })
  })
})
