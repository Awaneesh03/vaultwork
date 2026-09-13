import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import type { Id, Note, NoteLink } from '@/types/entities'
import type { RefType } from '@/types/enums'
import { createRepository } from './baseRepository'

const noteBase = createRepository('notes')
const linkBase = createRepository('noteLinks')

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((row) => row.deletedAt === null)

/** Most recently edited first — the order a notes list is useful in. */
const byRecent = (rows: Note[]) =>
  rows.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/**
 * Notes.
 *
 * A note is the only entity in the application whose body is free text, which
 * makes search a scan rather than an index hit — `updatedAt` and `vaultPath`
 * are indexed, the body deliberately is not. IndexedDB has no full-text index,
 * and a hand-rolled inverted index would be a second thing to keep in step with
 * the notes themselves for a corpus that fits comfortably in memory.
 */
export const noteRepo = {
  ...noteBase,

  /** Every live note, most recently edited first. */
  async listLive(): Promise<Note[]> {
    try {
      return byRecent(live(await db.notes.toArray()))
    } catch (error) {
      throw toRepositoryError('notes', error, 'listLive')
    }
  },

  /** Soft-deleted notes, for the Deleted filter and for restore. */
  async listTrashed(): Promise<Note[]> {
    try {
      const rows = await db.notes.toArray()
      return rows
        .filter((row) => row.deletedAt !== null)
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
    } catch (error) {
      throw toRepositoryError('notes', error, 'listTrashed')
    }
  },

  /** The n most recently edited live notes. Used by the Dashboard card. */
  async recent(limit: number): Promise<Note[]> {
    const rows = await this.listLive()
    return rows.slice(0, limit)
  },

  /**
   * Every vault path currently spoken for, deleted notes included.
   *
   * A soft-deleted note still owns its file: restoring it must not find that
   * some other note has taken the path in the meantime.
   */
  async takenVaultPaths(): Promise<string[]> {
    try {
      const rows = await db.notes.toArray()
      return rows
        .map((row) => row.vaultPath)
        .filter((path): path is string => path !== null && path.length > 0)
    } catch (error) {
      throw toRepositoryError('notes', error, 'takenVaultPaths')
    }
  },
}

/**
 * Note links.
 *
 * Indexed from both directions on purpose: `noteId` answers "what is this note
 * about?" and `[refType+refId]` answers "which notes mention this task?". Both
 * are index hits, so a backlink panel on a task costs one lookup rather than a
 * scan of every note in the database.
 */
export const noteLinkRepo = {
  ...linkBase,

  /** The live links of one note. */
  async forNote(noteId: Id): Promise<NoteLink[]> {
    try {
      return live(await db.noteLinks.where('noteId').equals(noteId).toArray())
    } catch (error) {
      throw toRepositoryError('noteLinks', error, 'forNote')
    }
  },

  /** The live links pointing at one entity — the backlink query. */
  async forRef(refType: RefType, refId: Id): Promise<NoteLink[]> {
    try {
      return live(await db.noteLinks.where('[refType+refId]').equals([refType, refId]).toArray())
    } catch (error) {
      throw toRepositoryError('noteLinks', error, 'forRef')
    }
  },

  /** Every live link, for building counts across a whole list in one read. */
  async listLive(): Promise<NoteLink[]> {
    try {
      return live(await db.noteLinks.toArray())
    } catch (error) {
      throw toRepositoryError('noteLinks', error, 'listLive')
    }
  },

  /** The existing live link between a note and an entity, if there is one. */
  async find(noteId: Id, refType: RefType, refId: Id): Promise<NoteLink | undefined> {
    const rows = await this.forNote(noteId)
    return rows.find((row) => row.refType === refType && row.refId === refId)
  },

  /**
   * Removes every link of a note for good.
   *
   * A hard delete, and only ever called when the note itself is purged. Soft
   * deletion of a note deliberately leaves its links in place so that restoring
   * the note restores what it was about.
   */
  async purgeForNote(noteId: Id): Promise<number> {
    try {
      const rows = await db.noteLinks.where('noteId').equals(noteId).toArray()
      await db.noteLinks.bulkDelete(rows.map((row) => row.id))
      return rows.length
    } catch (error) {
      throw toRepositoryError('noteLinks', error, 'purgeForNote')
    }
  },
}
