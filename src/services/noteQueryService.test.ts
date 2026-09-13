import { beforeEach, describe, expect, it } from 'vitest'
import { goalRepo, habitRepo, projectRepo, tagRepo, taskRepo } from '@/repositories'
import { projectInput, tagInput, taskInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { attachLink, createNote, deleteNote, updateNote } from './noteService'
import {
  getBacklinks,
  getNoteDetail,
  getNotesView,
  getRecentNotes,
  refPath,
} from './noteQueryService'

/**
 * The view models the notes UI renders.
 *
 * The property that matters most is that a link's label is *read* rather than
 * stored: renaming a task has to change what every note says about it, with no
 * propagation step and no stale copy anywhere.
 */

const NOW = new Date(2026, 8, 4, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const titles = (items: { title: string }[]) => items.map((item) => item.title)

describe('the notes view', () => {
  it('distinguishes an empty world from an empty filter result', async () => {
    expect((await getNotesView()).empty).toBe(true)

    await createNote({ title: 'Something' })
    const filtered = await getNotesView({ search: 'nothing matches' })
    expect(filtered.empty).toBe(false)
    expect(filtered.notes).toEqual([])
  })

  it('lists notes most recently edited first', async () => {
    const first = await createNote({ title: 'first' })
    await createNote({ title: 'second' })
    // Editing the older note moves it to the top.
    await updateNote(first.id, { body: 'changed' })

    expect(titles((await getNotesView()).notes)).toEqual(['first', 'second'])
  })

  it('counts every filter, whatever is currently shown', async () => {
    const linked = await createNote({ title: 'linked' })
    const task = await taskRepo.create(taskInput())
    await attachLink(linked.id, 'task', task.id)
    await createNote({ title: 'loose' })
    const gone = await createNote({ title: 'gone' })
    await deleteNote(gone.id)

    const view = await getNotesView()
    // `orphans` joined the counts in M12: none of these notes carries a
    // wikilink, so all three live ones are orphans.
    expect(view.counts).toEqual({ all: 2, linked: 1, unlinked: 1, orphans: 2, deleted: 1 })
  })

  it('filters to linked, unlinked and deleted', async () => {
    const linked = await createNote({ title: 'linked' })
    const task = await taskRepo.create(taskInput())
    await attachLink(linked.id, 'task', task.id)
    await createNote({ title: 'loose' })
    const gone = await createNote({ title: 'gone' })
    await deleteNote(gone.id)

    expect(titles((await getNotesView({ filter: 'linked' })).notes)).toEqual(['linked'])
    expect(titles((await getNotesView({ filter: 'unlinked' })).notes)).toEqual(['loose'])
    expect(titles((await getNotesView({ filter: 'deleted' })).notes)).toEqual(['gone'])
    // The default list never shows deleted notes.
    expect(titles((await getNotesView()).notes).sort()).toEqual(['linked', 'loose'])
  })

  it('falls back to the body when a note has no title', async () => {
    await createNote({ body: '# Binary search\n\nHalve the range.' })
    expect(titles((await getNotesView()).notes)).toEqual(['Binary search'])
  })

  it('previews the body with its markup stripped', async () => {
    await createNote({ title: 'a', body: '# Heading\n\n**bold** text' })
    const [item] = (await getNotesView()).notes
    expect(item?.excerpt).toBe('Heading bold text')
  })

  it('resolves tag ids to tags for the list', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    await createNote({ title: 'a', tagIds: [tag.id] })

    const [item] = (await getNotesView()).notes
    expect(item?.tags.map((t) => t.name)).toEqual(['dsa'])
  })

  it('reports how many things each note links to', async () => {
    const note = await createNote({ title: 'a' })
    const task = await taskRepo.create(taskInput())
    const project = await projectRepo.create(projectInput())
    await attachLink(note.id, 'task', task.id)
    await attachLink(note.id, 'project', project.id)

    const [item] = (await getNotesView()).notes
    expect(item?.linkCount).toBe(2)
  })
})

describe('search', () => {
  it('searches the title', async () => {
    await createNote({ title: 'Binary search' })
    await createNote({ title: 'Something else' })
    expect(titles((await getNotesView({ search: 'binary' })).notes)).toEqual(['Binary search'])
  })

  it('searches the body through its rendered text, not its markup', async () => {
    // Someone searching "binary" should find `**binary** search`.
    await createNote({ title: 'a', body: 'about **binary** trees' })
    await createNote({ title: 'b', body: 'about graphs' })
    expect(titles((await getNotesView({ search: 'binary' })).notes)).toEqual(['a'])
  })

  it('searches tag names', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    await createNote({ title: 'a', tagIds: [tag.id] })
    await createNote({ title: 'b' })
    expect(titles((await getNotesView({ search: 'dsa' })).notes)).toEqual(['a'])
  })

  it('requires every term, so a second word narrows', async () => {
    await createNote({ title: 'binary search trees' })
    await createNote({ title: 'binary heaps' })

    expect((await getNotesView({ search: 'binary' })).notes).toHaveLength(2)
    expect(titles((await getNotesView({ search: 'binary trees' })).notes)).toEqual([
      'binary search trees',
    ])
  })

  it('ignores case and surrounding whitespace', async () => {
    await createNote({ title: 'Binary Search' })
    expect((await getNotesView({ search: '  BINARY  ' })).notes).toHaveLength(1)
  })

  it('searches within the current filter, not across it', async () => {
    const gone = await createNote({ title: 'binary deleted' })
    await deleteNote(gone.id)
    await createNote({ title: 'binary live' })

    expect(titles((await getNotesView({ search: 'binary' })).notes)).toEqual(['binary live'])
    expect(titles((await getNotesView({ filter: 'deleted', search: 'binary' })).notes)).toEqual([
      'binary deleted',
    ])
  })
})

describe('link resolution', () => {
  it('labels a link from the entity, at read time', async () => {
    const task = await taskRepo.create(taskInput({ title: 'Original title' }))
    const note = await createNote({ title: 'a', links: [{ refType: 'task', refId: task.id }] })

    let detail = await getNoteDetail(note.id)
    expect(detail?.links[0]?.label).toBe('Original title')

    await taskRepo.update(task.id, { title: 'Renamed title' })

    // Nothing was propagated — the label is simply read again.
    detail = await getNoteDetail(note.id)
    expect(detail?.links[0]?.label).toBe('Renamed title')
  })

  it('labels all four kinds of entity', async () => {
    const note = await createNote({ title: 'a' })
    const task = await taskRepo.create(taskInput({ title: 'The task' }))
    const project = await projectRepo.create(projectInput({ name: 'The project' }))
    const goal = await goalRepo.create({
      title: 'The goal',
      why: null,
      horizon: 'long',
      status: 'active',
      targetDate: null,
      sortOrder: 1000,
      vaultPath: null,
    })
    const habit = await habitRepo.create({
      name: 'The habit',
      color: 'teal',
      cadence: 'daily',
      daysOfWeek: [],
      targetPerWeek: null,
      kind: 'binary',
      unit: null,
      target: null,
      sortOrder: 1000,
      archivedAt: null,
    })

    await attachLink(note.id, 'task', task.id)
    await attachLink(note.id, 'project', project.id)
    await attachLink(note.id, 'goal', goal.id)
    await attachLink(note.id, 'habit', habit.id)

    const detail = await getNoteDetail(note.id)
    expect(detail?.links.map((link) => link.label).sort()).toEqual([
      'The goal',
      'The habit',
      'The project',
      'The task',
    ])
    expect(detail?.links.every((link) => link.missing === false)).toBe(true)
  })

  it('marks a link whose target is gone rather than hiding it', async () => {
    const task = await taskRepo.create(taskInput({ title: 'Doomed' }))
    const note = await createNote({ title: 'a', links: [{ refType: 'task', refId: task.id }] })
    await taskRepo.softDelete(task.id)

    const detail = await getNoteDetail(note.id)
    // The note said it was about something; hiding that would be a quiet lie.
    expect(detail?.links).toHaveLength(1)
    expect(detail?.links[0]).toMatchObject({ missing: true, label: 'Deleted' })
  })

  it('gives every link a route that opens the entity', async () => {
    expect(refPath('task', 't1')).toBe('/tasks?task=t1')
    expect(refPath('project', 'p1')).toBe('/projects/p1')
    expect(refPath('goal', 'g1')).toBe('/goals?goal=g1')
    expect(refPath('habit', 'h1')).toBe('/habits?habit=h1')
  })
})

describe('note detail', () => {
  it('returns undefined for a note that does not exist', async () => {
    expect(await getNoteDetail('missing')).toBeUndefined()
  })

  it('opens a deleted note, so a link into the trash still works', async () => {
    const note = await createNote({ title: 'gone' })
    await deleteNote(note.id)

    const detail = await getNoteDetail(note.id)
    expect(detail?.title).toBe('gone')
    expect(detail?.note.deletedAt).not.toBeNull()
  })

  it('offers every tag, so the editor can apply one not yet used', async () => {
    await tagRepo.create(tagInput({ name: 'dsa' }))
    await tagRepo.create(tagInput({ name: 'college' }))
    const note = await createNote({ title: 'a' })

    const detail = await getNoteDetail(note.id)
    expect(detail?.allTags.map((tag) => tag.name).sort()).toEqual(['college', 'dsa'])
    expect(detail?.tags).toEqual([])
  })
})

describe('backlinks', () => {
  it('finds every note pointing at an entity, newest first', async () => {
    const task = await taskRepo.create(taskInput())
    const older = await createNote({ title: 'older', links: [{ refType: 'task', refId: task.id }] })
    const newer = await createNote({ title: 'newer', links: [{ refType: 'task', refId: task.id }] })
    await updateNote(newer.id, { body: 'touched' })

    const backlinks = await getBacklinks('task', task.id)
    expect(backlinks.map((b) => b.title)).toEqual(['newer', 'older'])
    expect(backlinks.map((b) => b.noteId)).toContain(older.id)
  })

  it('is empty for an entity nothing references', async () => {
    expect(await getBacklinks('task', 'nobody')).toEqual([])
  })

  it('does not leak notes linked to a different entity', async () => {
    const mine = await taskRepo.create(taskInput({ title: 'mine' }))
    const theirs = await taskRepo.create(taskInput({ title: 'theirs' }))
    await createNote({ title: 'a', links: [{ refType: 'task', refId: mine.id }] })
    await createNote({ title: 'b', links: [{ refType: 'task', refId: theirs.id }] })

    expect((await getBacklinks('task', mine.id)).map((b) => b.title)).toEqual(['a'])
  })

  it('does not confuse a task and a goal that share an id', async () => {
    // refType is part of the key, so the same id under two kinds is two things.
    const note = await createNote({ title: 'a' })
    await attachLink(note.id, 'task', 'shared')

    expect(await getBacklinks('task', 'shared')).toHaveLength(1)
    expect(await getBacklinks('goal', 'shared')).toHaveLength(0)
  })

  it('drops a deleted note from an entity backlinks', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({ title: 'a', links: [{ refType: 'task', refId: task.id }] })

    expect(await getBacklinks('task', task.id)).toHaveLength(1)
    await deleteNote(note.id)
    expect(await getBacklinks('task', task.id)).toHaveLength(0)
  })
})

describe('recent notes', () => {
  it('returns the most recently edited, capped', async () => {
    for (const title of ['a', 'b', 'c', 'd', 'e', 'f']) {
      await createNote({ title })
    }
    const recent = await getRecentNotes()
    expect(recent).toHaveLength(5)
    // Newest first: 'f' was created last.
    expect(recent[0]?.title).toBe('f')
  })

  it('ranks by edit time, not creation time', async () => {
    const first = await createNote({ title: 'first' })
    await createNote({ title: 'second' })
    await updateNote(first.id, { body: 'edited' })

    expect((await getRecentNotes())[0]?.title).toBe('first')
  })

  it('excludes deleted notes', async () => {
    const note = await createNote({ title: 'gone' })
    await deleteNote(note.id)
    expect(await getRecentNotes()).toEqual([])
  })

  it('carries a link count and an excerpt for the card', async () => {
    const task = await taskRepo.create(taskInput())
    await createNote({
      title: 'a',
      body: '# Heading\n\ntext',
      links: [{ refType: 'task', refId: task.id }],
    })

    const [recent] = await getRecentNotes()
    expect(recent).toMatchObject({ title: 'a', linkCount: 1, excerpt: 'Heading text' })
  })

  it('is empty and harmless with no notes', async () => {
    expect(await getRecentNotes()).toEqual([])
  })
})
