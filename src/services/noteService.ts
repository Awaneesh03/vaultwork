import { buildVaultPath, uniqueVaultPath } from '@/integrations/obsidian/vaultPath'
import { markdownToText } from '@/lib/markdown'
import { platform } from '@/platform'
import { noteLinkRepo, noteRepo, tagRepo } from '@/repositories'
import type { Id, Note, NoteLink } from '@/types/entities'
import type { EventSource, RefType } from '@/types/enums'
import { eventBus } from './eventBus'

/**
 * Everything that writes a note or a note link.
 *
 * Three rules shape this file:
 *
 *  1. **A note reserves its vault location at creation.** M9 writes no files,
 *     but every note gets a `vaultPath` the moment it exists, so M12 has
 *     nothing to backfill. A path is claimed exactly once and never
 *     recomputed behind the user's back — see `renameVaultPath`.
 *
 *  2. **Links store ids and nothing else.** A link row carries `refType` and
 *     `refId`, never a copied title. That is what makes a renamed task appear
 *     renamed inside every note that mentions it, with no propagation step.
 *
 *  3. **Autosave must not flood the log.** A save that changes nothing writes
 *     nothing and emits nothing, which is what keeps a 500 ms debounce from
 *     turning one edit into forty `note.updated` events.
 */

export interface NoteWriteOptions {
  source?: EventSource
}

export interface NoteInput {
  title?: string | undefined
  body?: string | undefined
  tagIds?: Id[] | undefined
  /** Attached at creation, so "new note about this task" is one call. */
  links?: NoteLinkInput[] | undefined
}

export interface NoteLinkInput {
  refType: RefType
  refId: Id
}

export type NotePatch = Partial<Pick<Note, 'title' | 'body' | 'tagIds'>>

/** What an untitled note is called, in one place. */
export const UNTITLED_NOTE = 'Untitled note'

const clean = (value: string) => value.trim().replace(/\s+/g, ' ')

/**
 * A note's display title.
 *
 * Unlike a task, a note is allowed to have no title — you open one to write,
 * not to name things. Rather than reject that, an empty title falls back to the
 * first line of the body, and only then to a placeholder. Nothing is stored
 * differently; this is purely how an empty string is presented.
 */
export function noteTitle(note: Pick<Note, 'title' | 'body'>): string {
  const title = clean(note.title)
  if (title.length > 0) return title

  // The *first line*, not the flattened body: a note that opens with a heading
  // is called by that heading, not by the heading plus the paragraph under it.
  // Run through the markdown flattener so `# Heading` reads as `Heading`.
  const firstLine = note.body.split('\n').find((line) => line.trim().length > 0) ?? ''
  const text = markdownToText(firstLine).slice(0, 80).trim()
  return text.length > 0 ? text : UNTITLED_NOTE
}

// --------------------------------------------------------------------- reads

export function listNotes(): Promise<Note[]> {
  return noteRepo.listLive()
}

export function getNote(id: Id): Promise<Note | undefined> {
  return noteRepo.get(id)
}

export function listTrashedNotes(): Promise<Note[]> {
  return noteRepo.listTrashed()
}

export function listNoteLinks(noteId: Id): Promise<NoteLink[]> {
  return noteLinkRepo.forNote(noteId)
}

/** The links pointing at one entity — what a backlink panel reads. */
export function linksForEntity(refType: RefType, refId: Id): Promise<NoteLink[]> {
  return noteLinkRepo.forRef(refType, refId)
}

// -------------------------------------------------------------- vault paths

/**
 * The path a note should reserve, given its title and tags.
 *
 * Resolved against every path already spoken for — including those of deleted
 * notes, which still own their file until they are purged.
 */
async function reservePath(title: string, tagIds: Id[], exclude?: Id): Promise<string> {
  const [tags, taken] = await Promise.all([tagRepo.list(), noteRepo.takenVaultPaths()])
  const names = tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined)

  const desired = buildVaultPath({ title, tags: names })

  // When re-reserving for an existing note, its own current path is not a clash.
  const current = exclude === undefined ? null : ((await noteRepo.get(exclude))?.vaultPath ?? null)
  const others = taken.filter((path) => path !== current)

  return uniqueVaultPath(desired, others)
}

// -------------------------------------------------------------------- create

export async function createNote(
  input: NoteInput = {},
  options: NoteWriteOptions = {},
): Promise<Note> {
  const source: EventSource = options.source ?? 'ui'
  const title = clean(input.title ?? '')
  const body = input.body ?? ''
  const tagIds = input.tagIds ?? []

  const note = await noteRepo.create(
    {
      title,
      body,
      tagIds,
      // The whole point of the milestone: the location exists from the start.
      vaultPath: await reservePath(title.length > 0 ? title : UNTITLED_NOTE, tagIds),
    },
    { source, emit: false },
  )

  for (const link of input.links ?? []) {
    await attachLink(note.id, link.refType, link.refId, { source, emit: false })
  }

  await eventBus.emit({
    type: 'note.created',
    entityType: 'note',
    entityId: note.id,
    source,
    payload: {
      title: noteTitle(note),
      vaultPath: note.vaultPath,
      links: (input.links ?? []).length,
    },
  })

  return note
}

// -------------------------------------------------------------------- update

/**
 * Applies a patch to a note.
 *
 * This is the autosave path, so the no-op check is load-bearing rather than an
 * optimisation: the editor calls it on a debounce, and without this a user
 * tabbing away from an unchanged note would append an event and bump
 * `updatedAt`, pushing the note to the top of a list it never actually changed.
 */
export async function updateNote(
  id: Id,
  patch: NotePatch,
  options: NoteWriteOptions = {},
): Promise<Note> {
  const source: EventSource = options.source ?? 'ui'
  const current = await noteRepo.getOrThrow(id)

  const next: NotePatch = { ...patch }
  if (typeof next.title === 'string') next.title = clean(next.title)

  const changed = (Object.keys(next) as (keyof NotePatch)[]).filter((field) => {
    const before = current[field]
    const after = next[field]
    if (Array.isArray(before) && Array.isArray(after)) {
      return before.length !== after.length || before.some((value, i) => value !== after[i])
    }
    return before !== after
  })

  if (changed.length === 0) return current

  const updated = await noteRepo.update(id, next, { source, emit: false })

  await eventBus.emit({
    type: 'note.updated',
    entityType: 'note',
    entityId: id,
    source,
    payload: { title: noteTitle(updated), fields: changed },
  })

  return updated
}

/**
 * Moves a note's reserved vault location to match its current title and tags.
 *
 * Deliberately a separate, explicit action rather than something `updateNote`
 * does. Renaming a note every time its title changes would rewrite the file
 * path on every keystroke of an autosaved edit, and once M12 is syncing that
 * means a file being moved forty times while somebody types a heading. The
 * reserved path is stable until the user asks for it to be re-derived.
 */
export async function renameVaultPath(
  id: Id,
  options: NoteWriteOptions = {},
): Promise<Note> {
  const source: EventSource = options.source ?? 'ui'
  const current = await noteRepo.getOrThrow(id)
  const next = await reservePath(noteTitle(current), current.tagIds, id)
  if (next === current.vaultPath) return current

  const updated = await noteRepo.update(id, { vaultPath: next }, { source, emit: false })

  await eventBus.emit({
    type: 'note.updated',
    entityType: 'note',
    entityId: id,
    source,
    payload: { title: noteTitle(updated), fields: ['vaultPath'], from: current.vaultPath },
  })

  return updated
}

// ------------------------------------------------------------ delete/restore

export interface NoteDeletion {
  note: Note
  /** Links left in place, so restoring returns the note with its references. */
  retainedLinkCount: number
}

/**
 * Soft delete. The links are left alone.
 *
 * That is what makes restore exactly reversible: the link rows still point at
 * the note, so bringing it back brings its references with it. Removing them
 * would be an irreversible mutation hidden inside a reversible one.
 */
export async function deleteNote(
  id: Id,
  options: NoteWriteOptions = {},
): Promise<NoteDeletion> {
  const source: EventSource = options.source ?? 'ui'
  const note = await noteRepo.getOrThrow(id)
  const links = await noteLinkRepo.forNote(id)

  await noteRepo.softDelete(id, { source, emit: false })

  await eventBus.emit({
    type: 'note.deleted',
    entityType: 'note',
    entityId: id,
    source,
    payload: { title: noteTitle(note), links: links.length },
  })

  return {
    note: { ...note, deletedAt: platform.clock.now() },
    retainedLinkCount: links.length,
  }
}

export async function restoreNote(id: Id, options: NoteWriteOptions = {}): Promise<Note> {
  const source: EventSource = options.source ?? 'ui'
  const note = await noteRepo.restore(id, { source, emit: false })

  await eventBus.emit({
    type: 'note.restored',
    entityType: 'note',
    entityId: id,
    source,
    payload: { title: noteTitle(note) },
  })

  return note
}

// -------------------------------------------------------------------- links

export class NoteLinkTargetError extends Error {
  constructor(refType: RefType) {
    super(`A note cannot be linked to "${refType}"`)
    this.name = 'NoteLinkTargetError'
  }
}

/** The four things a note may reference. `none` is the absence of a link. */
const LINKABLE: RefType[] = ['task', 'project', 'goal', 'habit']

export function isLinkable(refType: RefType): boolean {
  return LINKABLE.includes(refType)
}

/**
 * Links a note to an entity.
 *
 * Idempotent: attaching the same pair twice returns the existing row rather
 * than creating a second one, so a double click cannot produce a duplicate
 * backlink. Only the id is stored — the title is read through the link at
 * render time, which is why renaming a task updates every note that mentions it
 * with no propagation step at all.
 */
export async function attachLink(
  noteId: Id,
  refType: RefType,
  refId: Id,
  options: NoteWriteOptions & { emit?: boolean } = {},
): Promise<NoteLink> {
  const source: EventSource = options.source ?? 'ui'
  if (!isLinkable(refType)) throw new NoteLinkTargetError(refType)

  await noteRepo.getOrThrow(noteId)

  const existing = await noteLinkRepo.find(noteId, refType, refId)
  if (existing) return existing

  const link = await noteLinkRepo.create(
    { noteId, refType, refId },
    { source, emit: false },
  )

  if (options.emit !== false) {
    await eventBus.emit({
      type: 'note.linked',
      entityType: 'note',
      entityId: noteId,
      source,
      payload: { refType, refId },
    })
  }

  return link
}

/** Removes a link. The note and the entity are both untouched. */
export async function detachLink(
  noteId: Id,
  refType: RefType,
  refId: Id,
  options: NoteWriteOptions = {},
): Promise<boolean> {
  const source: EventSource = options.source ?? 'ui'
  const existing = await noteLinkRepo.find(noteId, refType, refId)
  if (!existing) return false

  // A hard delete: a link is a fact about a relationship, and "not linked" is
  // simply the absence of the row. A tombstone would have to be filtered out of
  // every count for no benefit.
  await noteLinkRepo.hardDelete(existing.id, { source, emit: false })

  await eventBus.emit({
    type: 'note.unlinked',
    entityType: 'note',
    entityId: noteId,
    source,
    payload: { refType, refId },
  })

  return true
}
