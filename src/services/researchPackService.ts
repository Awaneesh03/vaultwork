import {
  buildResearchPack,
  type ResearchPackDocument,
  type ResearchPackNote,
} from '@/integrations/obsidian/knowledge'
import { assertSafeVaultPath, parentDirectories } from '@/integrations/obsidian/vaultPath'
import { resolveWikilink, wikilinkTargets } from '@/integrations/obsidian/wikilinks'
import { platform } from '@/platform'
import { noteLinkRepo, noteRepo, projectRepo, taskRepo, vaultDocumentRepo } from '@/repositories'
import type { Id, Note } from '@/types/entities'
import type { EventSource } from '@/types/enums'
import { eventBus } from './eventBus'
import { noteTitle } from './noteService'
import { getVaultPort, requireConnected } from './obsidianService'
import { summarise } from './projects/projectStats'

/**
 * Research packs (M18.2): a project's knowledge, bundled for NotebookLM.
 *
 * There is no NotebookLM API to call, and pretending otherwise would be a
 * fragile integration that breaks the day Google changes a page. So this does
 * the durable part instead: it gathers what Vaultwork knows about a project —
 * the notes linked to it and the PDFs those notes cite — into a folder of
 * clean Markdown with provenance on every piece, which the user uploads.
 *
 * Every byte goes through `VaultPort`, the one filesystem boundary this
 * application has. This module names no path it did not build, and every path
 * it builds passes `assertSafeVaultPath` before it reaches the port.
 */

export interface ResearchPackResult {
  /** Vault-relative folder the pack was written to. */
  folder: string
  notes: number
  /** PDFs the manifest asks the user to upload alongside. */
  documents: ResearchPackDocument[]
  omitted: { notes: number; documents: number }
}

/** The live notes linked to a project, newest first. */
async function projectNotes(projectId: Id): Promise<Note[]> {
  const links = await noteLinkRepo.forRef('project', projectId)
  const notes = await Promise.all(links.map((link) => noteRepo.get(link.noteId)))
  return notes.filter((note): note is Note => note !== undefined && note.deletedAt === null)
}

/**
 * The imported PDFs a set of notes cites by wikilink.
 *
 * Resolved with the same matcher notes use for each other, so `[[System
 * Design.pdf]]` finds the document exactly as Obsidian would. Only resolved,
 * unambiguous links count: a pack that guessed which PDF was meant would put a
 * wrong source in front of a tool whose whole job is citing sources.
 */
async function citedDocuments(notes: Note[]): Promise<ResearchPackDocument[]> {
  const documents = await vaultDocumentRepo.listLive()
  if (documents.length === 0) return []

  const candidates = documents.map((document) => ({
    id: document.id,
    title: document.title,
    vaultPath: document.vaultPath,
  }))

  const cited = new Map<Id, ResearchPackDocument>()
  for (const note of notes) {
    for (const target of wikilinkTargets(note.body)) {
      const resolution = resolveWikilink(target, candidates)
      if (resolution.status !== 'resolved') continue
      const document = documents.find((row) => row.id === resolution.noteId)
      if (document) cited.set(document.id, { title: document.title, vaultPath: document.vaultPath })
    }
  }
  return [...cited.values()]
}

/**
 * Writes a research pack for one project into the vault.
 *
 * Never overwrites. Packs are dated to the minute, and a second pack in the
 * same minute takes a numbered folder rather than replacing the first — the
 * "never overwrite" rule `obsidianService` keeps for notes holds here too, even
 * though a pack is Vaultwork's own output.
 */
export async function createResearchPack(
  projectId: Id,
  options: { source?: EventSource } = {},
): Promise<ResearchPackResult> {
  await requireConnected()
  const vault = getVaultPort()
  const source = options.source ?? 'ui'

  const project = await projectRepo.getOrThrow(projectId)
  const today = platform.clock.today()
  const [notes, tasks] = await Promise.all([projectNotes(projectId), taskRepo.listLive()])
  const stats = summarise([project], tasks, today)[0]?.stats

  const packNotes: ResearchPackNote[] = notes.map((note) => ({
    title: noteTitle(note),
    body: note.body,
    kind: note.kind,
    provenance: note.provenance,
    vaultPath: note.vaultPath,
    updatedAt: note.updatedAt,
  }))

  const pack = buildResearchPack({
    project: {
      name: project.name,
      status: project.status,
      deadline: project.deadline,
      progress: stats?.progress ?? 0,
      remaining: stats?.remaining ?? 0,
    },
    notes: packNotes,
    documents: await citedDocuments(notes),
    generatedAt: platform.clock.now(),
  })

  let folder = pack.folder
  for (let attempt = 2; await vault.exists(`${folder}/README.md`); attempt += 1) {
    folder = `${pack.folder}-${attempt}`
  }

  for (const file of pack.files) {
    const path = assertSafeVaultPath(`${folder}/${file.name}`)
    for (const directory of parentDirectories(path)) await vault.createDirectory(directory)
    await vault.writeFile(path, file.contents)
  }

  await eventBus.emit({
    type: 'knowledge.pack_created',
    entityType: 'project',
    entityId: projectId,
    source,
    payload: { folder, notes: packNotes.length, documents: pack.documents.length },
  })

  return {
    folder,
    notes: pack.files.length - 1,
    documents: pack.documents,
    omitted: pack.omitted,
  }
}
