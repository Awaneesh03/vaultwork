import {
  buildKnowledgeIndex,
  orphanIds,
  type KnowledgeNote,
} from '@/integrations/obsidian/knowledgeIndex'
import { markdownExcerpt, markdownToText } from '@/lib/markdown'
import { platform } from '@/platform'
import {
  goalRepo,
  habitRepo,
  noteLinkRepo,
  noteRepo,
  projectRepo,
  tagRepo,
  taskRepo,
} from '@/repositories'
import type { DateStr, Id, Note, NoteLink, Tag } from '@/types/entities'
import type { RefType } from '@/types/enums'
import { noteTitle } from './noteService'

/**
 * Every read the notes UI performs — and the ones the entity panels and the
 * Dashboard perform.
 *
 * The important property is that a link is *resolved at read time*. A note
 * stores only `refType` and `refId`; the label comes from the entity itself on
 * every render, so renaming a task shows up inside every note that references
 * it without anything being propagated. A link whose target has been deleted is
 * reported as missing rather than silently dropped — the note said it was about
 * something, and hiding that would be a quiet lie.
 */

export interface NoteLinkView {
  link: NoteLink
  refType: RefType
  refId: Id
  /** Read from the entity now, never copied onto the link row. */
  label: string
  /** Where clicking it goes. */
  href: string
  /** True when the entity no longer exists or was deleted. */
  missing: boolean
}

export interface NoteListItem {
  note: Note
  /** Title, or the fallback when the note has none. */
  title: string
  excerpt: string
  tags: Tag[]
  linkCount: number
  links: NoteLinkView[]
}

/**
 * `linked` / `unlinked` are about `noteLinks` — the explicit relationships a
 * note has to a task, project, goal or habit. `orphans` is a different
 * question, about wikilinks between notes, and gets its own value rather than
 * overloading either of the others.
 */
export type NoteFilterKind = 'all' | 'linked' | 'unlinked' | 'deleted' | 'orphans'

export interface NotesViewData {
  notes: NoteListItem[]
  /** From the clock port, so no component ever reads the wall clock itself. */
  now: number
  today: DateStr
  counts: Record<NoteFilterKind, number>
  /** True when there is not a single note, as opposed to none matching. */
  empty: boolean
}

export interface NotesViewOptions {
  filter?: NoteFilterKind | undefined
  search?: string | undefined
  /** Narrows to notes carrying this tag, using the existing `Note.tagIds`. */
  tagId?: Id | null | undefined
}

// ------------------------------------------------------------------- linking

/** Where each kind of entity lives. One definition, shared by every caller. */
export function refPath(refType: RefType, refId: Id): string {
  switch (refType) {
    case 'task':
      return `/tasks?task=${refId}`
    case 'project':
      return `/projects/${refId}`
    case 'goal':
      return `/goals?goal=${refId}`
    case 'habit':
      return `/habits?habit=${refId}`
    case 'none':
      return '/notes'
  }
}

export const REF_LABELS: Record<RefType, string> = {
  task: 'Task',
  project: 'Project',
  goal: 'Goal',
  habit: 'Habit',
  none: 'Nothing',
}

/** Everything a link label could need, read once for a whole screen. */
interface LinkWorld {
  tasks: Map<Id, string>
  projects: Map<Id, string>
  goals: Map<Id, string>
  habits: Map<Id, string>
}

async function readLinkWorld(): Promise<LinkWorld> {
  const [tasks, projects, goals, habits] = await Promise.all([
    taskRepo.list(),
    projectRepo.list(),
    goalRepo.list(),
    habitRepo.list(),
  ])

  return {
    tasks: new Map(tasks.map((row) => [row.id, row.title])),
    projects: new Map(projects.map((row) => [row.id, row.name])),
    goals: new Map(goals.map((row) => [row.id, row.title])),
    habits: new Map(habits.map((row) => [row.id, row.name])),
  }
}

function resolveLink(link: NoteLink, world: LinkWorld): NoteLinkView {
  const table =
    link.refType === 'task'
      ? world.tasks
      : link.refType === 'project'
        ? world.projects
        : link.refType === 'goal'
          ? world.goals
          : link.refType === 'habit'
            ? world.habits
            : new Map<Id, string>()

  const label = table.get(link.refId)

  return {
    link,
    refType: link.refType,
    refId: link.refId,
    // A deleted target keeps its slot and says so, rather than vanishing.
    label: label ?? 'Deleted',
    href: refPath(link.refType, link.refId),
    missing: label === undefined,
  }
}

// -------------------------------------------------------------------- search

/**
 * Whether a note matches a query.
 *
 * Searches the title, the *rendered text* of the body and the tag names. Using
 * rendered text rather than raw markdown means searching "binary" finds a note
 * whose body says `**binary** search` — the user typed a word, not a delimiter.
 * Every term must match, so a second word narrows rather than widens.
 */
export function matchesNoteSearch(item: NoteListItem, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true

  const haystack = [
    item.title,
    markdownToText(item.note.body),
    item.tags.map((tag) => tag.name).join(' '),
  ]
    .join('  ')
    .toLowerCase()

  return terms.every((term) => haystack.includes(term))
}

// --------------------------------------------------------------------- views

/** Shapes notes for the knowledge index, which needs bodies and paths only. */
function knowledgeNotes(live: Note[], trashed: Note[]): KnowledgeNote[] {
  const shape = (note: Note, deleted: boolean): KnowledgeNote => ({
    id: note.id,
    title: noteTitle(note),
    body: note.body,
    tagIds: note.tagIds,
    vaultPath: note.vaultPath,
    updatedAt: note.updatedAt,
    deleted,
  })
  return [...live.map((n) => shape(n, false)), ...trashed.map((n) => shape(n, true))]
}

function buildItem(note: Note, links: NoteLink[], tags: Tag[], world: LinkWorld): NoteListItem {
  const own = links.filter((link) => link.noteId === note.id)

  return {
    note,
    title: noteTitle(note),
    excerpt: markdownExcerpt(note.body),
    tags: note.tagIds
      .map((id) => tags.find((tag) => tag.id === id))
      .filter((tag): tag is Tag => tag !== undefined),
    linkCount: own.length,
    links: own.map((link) => resolveLink(link, world)),
  }
}

/**
 * The notes screen.
 *
 * Assembled from a fixed number of table reads regardless of how many notes
 * exist — notes, links, tags and the four linkable entity tables — then joined
 * in memory. Resolving each note's links with its own query would be an N+1
 * that gets slower with every note added.
 */
export async function getNotesView(options: NotesViewOptions = {}): Promise<NotesViewData> {
  const filter: NoteFilterKind = options.filter ?? 'all'

  const [live, trashed, links, tags, world] = await Promise.all([
    noteRepo.listLive(),
    noteRepo.listTrashed(),
    noteLinkRepo.listLive(),
    tagRepo.list(),
    readLinkWorld(),
  ])

  const liveItems = live.map((note) => buildItem(note, links, tags, world))
  const trashedItems = trashed.map((note) => buildItem(note, links, tags, world))

  // Orphan status comes from the knowledge layer, which derives it from the
  // wikilinks in the note bodies — there is no stored flag to read.
  const orphans = orphanIds(buildKnowledgeIndex(knowledgeNotes(live, trashed)))
  const orphanSet = new Set(orphans)

  const counts: Record<NoteFilterKind, number> = {
    all: liveItems.length,
    linked: liveItems.filter((item) => item.linkCount > 0).length,
    unlinked: liveItems.filter((item) => item.linkCount === 0).length,
    deleted: trashedItems.length,
    orphans: orphans.length,
  }

  const pool =
    filter === 'deleted'
      ? trashedItems
      : filter === 'linked'
        ? liveItems.filter((item) => item.linkCount > 0)
        : filter === 'unlinked'
          ? liveItems.filter((item) => item.linkCount === 0)
          : filter === 'orphans'
            ? liveItems.filter((item) => orphanSet.has(item.note.id))
            : liveItems

  const search = options.search ?? ''
  const tagId = options.tagId ?? null

  return {
    notes: pool
      .filter((item) => tagId === null || item.note.tagIds.includes(tagId))
      .filter((item) => matchesNoteSearch(item, search)),
    now: platform.clock.now(),
    today: platform.clock.today(),
    counts,
    empty: liveItems.length === 0 && trashedItems.length === 0,
  }
}

export interface NoteDetailData extends NoteListItem {
  /** Every tag, so the editor can offer the ones not yet applied. */
  allTags: Tag[]
  now: number
  today: DateStr
}

export async function getNoteDetail(id: Id): Promise<NoteDetailData | undefined> {
  // Deleted notes are readable by id so that a link into the trash still opens.
  const note = await noteRepo.get(id, { includeDeleted: true })
  if (!note) return undefined

  const [links, tags, world] = await Promise.all([
    noteLinkRepo.forNote(id),
    tagRepo.list(),
    readLinkWorld(),
  ])

  return {
    ...buildItem(note, links, tags, world),
    allTags: tags,
    now: platform.clock.now(),
    today: platform.clock.today(),
  }
}

/**
 * Everything a note can be linked to, resolved to labels.
 *
 * Deleted rows are excluded by the repositories, so the picker can only offer
 * things that currently exist — the "missing" state is for links made earlier
 * whose target has since gone, never for something newly attachable.
 */
export interface LinkCandidate {
  refType: RefType
  refId: Id
  label: string
}

export async function getLinkCandidates(): Promise<LinkCandidate[]> {
  const [tasks, projects, goals, habits] = await Promise.all([
    taskRepo.list(),
    projectRepo.list(),
    goalRepo.list(),
    habitRepo.list(),
  ])

  return [
    ...tasks
      .filter((task) => !task.isTemplate)
      .map((task) => ({ refType: 'task' as const, refId: task.id, label: task.title })),
    ...projects.map((row) => ({ refType: 'project' as const, refId: row.id, label: row.name })),
    ...goals.map((row) => ({ refType: 'goal' as const, refId: row.id, label: row.title })),
    ...habits.map((row) => ({ refType: 'habit' as const, refId: row.id, label: row.name })),
  ]
}

// ----------------------------------------------------------------- backlinks

export interface Backlink {
  noteId: Id
  title: string
  excerpt: string
  updatedAt: number
}

/**
 * The notes referencing one entity.
 *
 * One indexed lookup on `[refType+refId]`, so a backlink panel on a task costs
 * the same whether the database holds ten notes or ten thousand. Deleted notes
 * are excluded: a panel should show what currently points here.
 */
export async function getBacklinks(refType: RefType, refId: Id): Promise<Backlink[]> {
  const links = await noteLinkRepo.forRef(refType, refId)
  if (links.length === 0) return []

  const notes = await Promise.all(links.map((link) => noteRepo.get(link.noteId)))

  return notes
    .filter((note): note is Note => note !== undefined)
    .map((note) => ({
      noteId: note.id,
      title: noteTitle(note),
      excerpt: markdownExcerpt(note.body, 90),
      updatedAt: note.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.noteId < b.noteId ? -1 : 1))
}

// ----------------------------------------------------------------- dashboard

export const DASHBOARD_NOTE_LIMIT = 5

export interface RecentNote {
  id: Id
  title: string
  excerpt: string
  updatedAt: number
  linkCount: number
}

/**
 * The Dashboard's slice: the most recently edited notes.
 *
 * "Recent" means recently *edited*, not recently created — the note you were
 * last working in is the one you are most likely to want again.
 */
export async function getRecentNotes(
  limit: number = DASHBOARD_NOTE_LIMIT,
): Promise<RecentNote[]> {
  const [notes, links] = await Promise.all([noteRepo.recent(limit), noteLinkRepo.listLive()])

  return notes.map((note) => ({
    id: note.id,
    title: noteTitle(note),
    excerpt: markdownExcerpt(note.body, 90),
    updatedAt: note.updatedAt,
    linkCount: links.filter((link) => link.noteId === note.id).length,
  }))
}
