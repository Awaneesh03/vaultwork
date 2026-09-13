import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { noteLinkRepo, projectRepo, tagRepo, taskRepo } from '@/repositories'
import { projectInput, tagInput, taskInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import {
  NoteLinkTargetError,
  UNTITLED_NOTE,
  attachLink,
  createNote,
  deleteNote,
  detachLink,
  getNote,
  linksForEntity,
  listNoteLinks,
  listNotes,
  listTrashedNotes,
  noteTitle,
  renameVaultPath,
  restoreNote,
  updateNote,
} from './noteService'

/**
 * The note rules, against a real database.
 *
 * The load-bearing families here are vault-path reservation (which M12 depends
 * on and cannot be fixed later without a migration), the autosave no-op check,
 * and the promise that a link stores an id and never a copied title.
 */

const NOW = new Date(2026, 8, 4, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const eventTypes = async (entityId?: string) =>
  (await db.events.toArray())
    .filter((event) => entityId === undefined || event.entityId === entityId)
    .sort((a, b) => a.at - b.at)
    .map((event) => event.type)

describe('creating', () => {
  it('creates an empty note without complaint', async () => {
    // Unlike a task, a note is opened to write in, not to name.
    const note = await createNote()
    expect(note.title).toBe('')
    expect(note.body).toBe('')
    expect(note.deletedAt).toBeNull()
    expect(await listNotes()).toHaveLength(1)
  })

  it('stores title, body and tags', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    const note = await createNote({
      title: '  Binary   Search ',
      body: '# Halve it',
      tagIds: [tag.id],
    })

    expect(note.title).toBe('Binary Search')
    expect(note.body).toBe('# Halve it')
    expect(note.tagIds).toEqual([tag.id])
  })

  it('reserves a vault path at creation, before any sync exists', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    const note = await createNote({ title: 'Binary Search', tagIds: [tag.id] })

    // This is the whole contract M12 will rely on.
    expect(note.vaultPath).toBe('notes/dsa/binary-search.md')
  })

  it('reserves a path for an untitled note too', async () => {
    const note = await createNote()
    expect(note.vaultPath).toBe('notes/untitled-note.md')
  })

  it('never gives two notes the same path', async () => {
    const first = await createNote({ title: 'Ideas' })
    const second = await createNote({ title: 'Ideas' })
    const third = await createNote({ title: 'Ideas' })

    expect(first.vaultPath).toBe('notes/ideas.md')
    expect(second.vaultPath).toBe('notes/ideas-2.md')
    expect(third.vaultPath).toBe('notes/ideas-3.md')
  })

  it('does not hand a deleted note path to a new note', async () => {
    // A deleted note still owns its file until it is purged; reusing the path
    // would make restore collide.
    const first = await createNote({ title: 'Ideas' })
    await deleteNote(first.id)

    const second = await createNote({ title: 'Ideas' })
    expect(second.vaultPath).toBe('notes/ideas-2.md')
  })

  it('attaches links given at creation', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({
      title: 'About the task',
      links: [{ refType: 'task', refId: task.id }],
    })

    const links = await listNoteLinks(note.id)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ refType: 'task', refId: task.id })
  })

  it('emits exactly one note.created, even with links attached', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({
      title: 'x',
      links: [{ refType: 'task', refId: task.id }],
    })

    // The link rows are part of creating the note, not four more events.
    expect(await eventTypes(note.id)).toEqual(['note.created'])
  })
})

describe('titles', () => {
  it('falls back to the first line of the body', async () => {
    expect(noteTitle({ title: '', body: '# Binary search\n\nmore' })).toBe('Binary search')
  })

  it('falls back to a placeholder when there is nothing at all', () => {
    expect(noteTitle({ title: '', body: '' })).toBe(UNTITLED_NOTE)
    expect(noteTitle({ title: '   ', body: '   ' })).toBe(UNTITLED_NOTE)
  })

  it('prefers a real title over the body', () => {
    expect(noteTitle({ title: 'Real', body: '# Other' })).toBe('Real')
  })
})

describe('updating and autosave', () => {
  it('saves title, body and tags', async () => {
    const note = await createNote({ title: 'a' })
    const updated = await updateNote(note.id, { title: 'b', body: 'text' })
    expect(updated).toMatchObject({ title: 'b', body: 'text' })
  })

  it('writes nothing when the content has not changed', async () => {
    // The autosave debounce fires on blur and on idle; without this an
    // unchanged note would bump updatedAt and jump to the top of the list.
    const note = await createNote({ title: 'a', body: 'text' })
    const before = await eventTypes(note.id)

    const same = await updateNote(note.id, { title: 'a', body: 'text' })

    expect(same.updatedAt).toBe(note.updatedAt)
    expect(await eventTypes(note.id)).toEqual(before)
  })

  it('emits one note.updated per real change, not per keystroke', async () => {
    const note = await createNote({ title: 'a' })
    await updateNote(note.id, { body: 'x' })
    await updateNote(note.id, { body: 'xy' })
    await updateNote(note.id, { body: 'xy' })

    expect(await eventTypes(note.id)).toEqual(['note.created', 'note.updated', 'note.updated'])
  })

  it('detects a tag list changing', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    const note = await createNote({ title: 'a' })

    const updated = await updateNote(note.id, { tagIds: [tag.id] })
    expect(updated.tagIds).toEqual([tag.id])

    const again = await updateNote(note.id, { tagIds: [tag.id] })
    expect(again.updatedAt).toBe(updated.updatedAt)
  })

  it('does not move the vault path when the title changes', async () => {
    // Re-deriving on every autosave would move the file on every keystroke
    // once M12 is writing to disk.
    const note = await createNote({ title: 'Original' })
    const updated = await updateNote(note.id, { title: 'Something else entirely' })

    expect(updated.vaultPath).toBe('notes/original.md')
  })

  it('moves the path only when explicitly asked', async () => {
    const note = await createNote({ title: 'Original' })
    await updateNote(note.id, { title: 'Renamed' })

    const moved = await renameVaultPath(note.id)
    expect(moved.vaultPath).toBe('notes/renamed.md')
  })

  it('is a no-op when the path is already right', async () => {
    const note = await createNote({ title: 'Original' })
    const same = await renameVaultPath(note.id)
    expect(same.updatedAt).toBe(note.updatedAt)
  })

  it('does not collide with another note when renaming', async () => {
    await createNote({ title: 'Taken' })
    const note = await createNote({ title: 'Other' })
    await updateNote(note.id, { title: 'Taken' })

    const moved = await renameVaultPath(note.id)
    expect(moved.vaultPath).toBe('notes/taken-2.md')
  })
})

describe('deleting and restoring', () => {
  it('hides a deleted note and keeps its links', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({
      title: 'About',
      links: [{ refType: 'task', refId: task.id }],
    })

    const deletion = await deleteNote(note.id)
    expect(deletion.retainedLinkCount).toBe(1)
    expect(await listNotes()).toHaveLength(0)
    expect(await getNote(note.id)).toBeUndefined()
    expect(await listTrashedNotes()).toHaveLength(1)

    // The link row survived, which is the only reason restore can be exact.
    expect(await noteLinkRepo.forNote(note.id)).toHaveLength(1)
  })

  it('restores a note with its content and references intact', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({
      title: 'About',
      body: 'text',
      links: [{ refType: 'task', refId: task.id }],
    })
    await deleteNote(note.id)

    const restored = await restoreNote(note.id)
    expect(restored).toMatchObject({ title: 'About', body: 'text', vaultPath: 'notes/about.md' })
    expect(await listNoteLinks(note.id)).toHaveLength(1)
  })

  it('never deletes the entity a note was about', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({ links: [{ refType: 'task', refId: task.id }] })

    await deleteNote(note.id)

    expect(await taskRepo.get(task.id)).toBeDefined()
    expect((await taskRepo.get(task.id))?.status).toBe('todo')
  })

  it('emits delete and restore exactly once each', async () => {
    const note = await createNote()
    await deleteNote(note.id)
    await restoreNote(note.id)

    expect(await eventTypes(note.id)).toEqual(['note.created', 'note.deleted', 'note.restored'])
  })
})

describe('linking', () => {
  it('links a note to all four kinds of entity', async () => {
    const note = await createNote({ title: 'Everything' })
    const task = await taskRepo.create(taskInput())
    const project = await projectRepo.create(projectInput())

    await attachLink(note.id, 'task', task.id)
    await attachLink(note.id, 'project', project.id)
    await attachLink(note.id, 'goal', 'g1')
    await attachLink(note.id, 'habit', 'h1')

    const links = await listNoteLinks(note.id)
    expect(links.map((link) => link.refType).sort()).toEqual(['goal', 'habit', 'project', 'task'])
  })

  it('is idempotent — a double click cannot make two links', async () => {
    const note = await createNote()
    const task = await taskRepo.create(taskInput())

    const first = await attachLink(note.id, 'task', task.id)
    const second = await attachLink(note.id, 'task', task.id)

    expect(second.id).toBe(first.id)
    expect(await listNoteLinks(note.id)).toHaveLength(1)
  })

  it('refuses a target that is not linkable', async () => {
    const note = await createNote()
    // `none` is the model's word for "no reference", not a thing to link to.
    await expect(attachLink(note.id, 'none', 'x')).rejects.toThrow(NoteLinkTargetError)
  })

  it('refuses to link from a note that does not exist', async () => {
    await expect(attachLink('missing', 'task', 't1')).rejects.toThrow()
  })

  it('detaches without touching the note or the entity', async () => {
    const note = await createNote({ title: 'About' })
    const task = await taskRepo.create(taskInput())
    await attachLink(note.id, 'task', task.id)

    expect(await detachLink(note.id, 'task', task.id)).toBe(true)
    expect(await listNoteLinks(note.id)).toHaveLength(0)
    expect(await getNote(note.id)).toMatchObject({ title: 'About' })
    expect(await taskRepo.get(task.id)).toBeDefined()
  })

  it('reports detaching something that was never linked', async () => {
    const note = await createNote()
    expect(await detachLink(note.id, 'task', 'nope')).toBe(false)
  })

  it('stores an id, so a renamed task reads renamed everywhere', async () => {
    const task = await taskRepo.create(taskInput({ title: 'Original title' }))
    const note = await createNote({ links: [{ refType: 'task', refId: task.id }] })

    await taskRepo.update(task.id, { title: 'Renamed title' })

    // Nothing propagated, because nothing was ever copied: the link holds the
    // id and the title is read through it.
    const [link] = await listNoteLinks(note.id)
    expect(link).toMatchObject({ refId: task.id })
    expect(JSON.stringify(link)).not.toContain('Original title')
    expect((await taskRepo.get(task.id))?.title).toBe('Renamed title')
  })

  it('finds the notes pointing at one entity — the backlink query', async () => {
    const task = await taskRepo.create(taskInput())
    const other = await taskRepo.create(taskInput({ title: 'other' }))

    const a = await createNote({ title: 'a', links: [{ refType: 'task', refId: task.id }] })
    const b = await createNote({ title: 'b', links: [{ refType: 'task', refId: task.id }] })
    await createNote({ title: 'c', links: [{ refType: 'task', refId: other.id }] })

    const links = await linksForEntity('task', task.id)
    expect(links.map((link) => link.noteId).sort()).toEqual([a.id, b.id].sort())
  })

  it('emits a link event per attachment made after creation', async () => {
    const note = await createNote()
    const task = await taskRepo.create(taskInput())

    await attachLink(note.id, 'task', task.id)
    await attachLink(note.id, 'task', task.id)
    await detachLink(note.id, 'task', task.id)

    // The second attach was a no-op and must not appear.
    expect(await eventTypes(note.id)).toEqual(['note.created', 'note.linked', 'note.unlinked'])
  })
})

describe('the event log', () => {
  it('writes nothing at all for reading', async () => {
    const note = await createNote({ title: 'a' })
    const before = new Set((await db.events.toArray()).map((event) => event.id))

    await getNote(note.id)
    await listNotes()
    await listNoteLinks(note.id)
    await listTrashedNotes()

    const added = (await db.events.toArray()).filter((event) => !before.has(event.id))
    expect(added).toEqual([])
  })

  it('records the source that asked', async () => {
    const note = await createNote({ title: 'a' }, { source: 'palette' })
    const [event] = (await db.events.toArray()).filter((e) => e.entityId === note.id)
    expect(event).toMatchObject({ type: 'note.created', source: 'palette' })
  })
})
