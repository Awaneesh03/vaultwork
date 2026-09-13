import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { taskRepo } from '@/repositories'
import {
  byId,
  createNote,
  execute,
  executeText,
  listNoteLinks,
  listNotes,
  parseCommand,
  resolveChoice,
  type CommandIntent,
} from '@/services'
import { taskInput } from './factories'
import { freezeClock, resetDatabase } from './helpers'

/**
 * Notes through the whole command pipeline: text -> intent -> execute -> Dexie.
 *
 * The two things worth proving end to end are that a note command reverses
 * exactly, and that **quick add never invents a note** — bare text is always a
 * task, whatever it looks like.
 */

const NOW = new Date(2026, 8, 4, 10, 0, 0)
const ctx = { source: 'palette' as const, now: NOW }

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

describe('parsing', () => {
  it('routes /notes and a bare /note to the Notes screen', () => {
    expect(parseCommand('/notes', ctx)).toMatchObject({
      kind: 'app.navigate',
      path: '/notes',
    })
    expect(parseCommand('/note', ctx)).toMatchObject({
      kind: 'app.navigate',
      path: '/notes',
    })
  })

  it('routes /note <title> to opening one note', () => {
    expect(parseCommand('/note binary', ctx)).toMatchObject({
      kind: 'note.open',
      ref: { by: 'text', query: 'binary' },
    })
  })

  it('creates a note only from the explicit /add note form', () => {
    expect(parseCommand('/add note Binary search', ctx)).toMatchObject({
      kind: 'note.add',
      title: 'Binary search',
    })
  })

  it('never infers a note from ordinary quick-add text', () => {
    // All of these read like something you would write down. Every one is a
    // task, because guessing would file it where nobody is looking.
    for (const text of [
      'Write up the binary search notes',
      'note: remember the invariant',
      'my notes on graphs',
    ]) {
      expect(parseCommand(text, ctx).kind).toBe('task.add')
    }
  })

  it('does not treat /add notebook or /notepad as note syntax', () => {
    expect(parseCommand('/add notebook paper', ctx).kind).toBe('task.add')
    expect(parseCommand('/notepad', ctx)).toMatchObject({ kind: 'unknown' })
  })
})

describe('note commands', () => {
  it('adds a note and undoes it exactly', async () => {
    const added = await executeText('/add note Binary search', ctx)
    expect(added.status).toBe('ok')
    expect(await listNotes()).toHaveLength(1)

    if (added.status !== 'ok' || added.kind !== 'note') throw new Error('expected a note')
    // The path was reserved on the way through the command layer too.
    expect(added.note.vaultPath).toBe('notes/binary-search.md')

    await execute(added.undo as CommandIntent)
    expect(await listNotes()).toHaveLength(0)
  })

  it('reverses a delete, bringing the note back with its links', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({
      title: 'About',
      links: [{ refType: 'task', refId: task.id }],
    })

    const deleted = await execute({
      kind: 'note.delete',
      source: 'palette',
      raw: '',
      ref: byId(note.id),
    })
    if (deleted.status !== 'ok' || deleted.kind !== 'note') throw new Error('expected a note')
    expect(deleted.message).toContain('1 link kept')
    expect(await listNotes()).toHaveLength(0)

    await execute(deleted.undo as CommandIntent)
    expect(await listNotes()).toHaveLength(1)
    expect(await listNoteLinks(note.id)).toHaveLength(1)
  })

  it('links and unlinks, each reversing the other', async () => {
    const note = await createNote({ title: 'a' })
    const task = await taskRepo.create(taskInput())

    const linked = await execute({
      kind: 'note.link',
      source: 'ui',
      raw: '',
      noteId: note.id,
      refType: 'task',
      refId: task.id,
    })
    if (linked.status !== 'ok' || linked.kind !== 'note') throw new Error('expected a note')
    expect(await listNoteLinks(note.id)).toHaveLength(1)

    await execute(linked.undo as CommandIntent)
    expect(await listNoteLinks(note.id)).toHaveLength(0)
  })

  it('refuses to guess between two notes with similar titles', async () => {
    await createNote({ title: 'Binary search' })
    await createNote({ title: 'Binary heaps' })

    const result = await executeText('/note binary', ctx)
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') throw new Error('expected ambiguity')
    expect(result.choices).toHaveLength(2)

    // Notes are listed most-recently-edited first, so the choice order is not
    // creation order — assert against the option actually picked.
    const choice = result.choices[1]!
    const picked = await resolveChoice(result.intent, choice.id)
    expect(picked.status).toBe('ok')
    expect(picked.message).toBe(choice.label)
  })

  it('opens a note at its own route', async () => {
    const note = await createNote({ title: 'Binary search' })
    const result = await executeText('/note binary search', ctx)

    expect(result).toMatchObject({ status: 'ok', kind: 'navigate', path: `/notes/${note.id}` })
  })

  it('reports a note that does not exist without creating one', async () => {
    const result = await executeText('/note nothing like this', ctx)
    expect(result.status).toBe('not_found')
    expect(await listNotes()).toHaveLength(0)
  })

  it('never deletes the entity a note referenced', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({ links: [{ refType: 'task', refId: task.id }] })

    await execute({ kind: 'note.delete', source: 'ui', raw: '', ref: byId(note.id) })

    expect(await taskRepo.get(task.id)).toBeDefined()
    expect((await taskRepo.get(task.id))?.status).toBe('todo')
  })
})

describe('the event log', () => {
  it('records one event per command, with the source that asked', async () => {
    const before = new Set((await db.events.toArray()).map((event) => event.id))

    await executeText('/add note Binary search', ctx)

    const added = (await db.events.toArray()).filter((event) => !before.has(event.id))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ type: 'note.created', source: 'palette' })
  })

  it('writes only note events when a note command runs', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({ links: [{ refType: 'task', refId: task.id }] })

    const before = new Set((await db.events.toArray()).map((event) => event.id))
    await execute({ kind: 'note.delete', source: 'ui', raw: '', ref: byId(note.id) })
    await execute({ kind: 'note.restore', source: 'ui', raw: '', noteId: note.id })

    const added = (await db.events.toArray()).filter((event) => !before.has(event.id))
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((event) => event.entityType === 'note')).toBe(true)
    expect(added.map((event) => event.type).sort()).toEqual([
      'note.deleted',
      'note.restored',
    ])
  })
})
