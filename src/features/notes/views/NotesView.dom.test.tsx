import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { tagRepo, taskRepo } from '@/repositories'
import { attachLink, createNote, deleteNote, listNotes } from '@/services'
import { useNoteUiStore } from '@/store/noteUiStore'
import { useToastStore } from '@/store/toastStore'
import { tagInput, taskInput } from '../../../../tests/factories'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { NoteDetailView } from './NoteDetailView'
import { NotesView } from './NotesView'

/**
 * The Notes screens, mounted against a real database.
 *
 * `noteService.test.ts` proves the rules with no React; this proves the screens
 * are wired to them — that typing autosaves, that markdown renders as elements
 * rather than HTML, and that a link opens the thing it names.
 */

const NOW = new Date(2026, 8, 4, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useNoteUiStore.getState().reset()
  // `mode` survives `reset()` on purpose — it is a preference, not a filter —
  // so a test that changes it has to put it back for the next one.
  useNoteUiStore.setState({ mode: 'split' })
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mountList = () =>
  render(
    <MemoryRouter initialEntries={['/notes']}>
      <Routes>
        <Route path="/notes" element={<NotesView />} />
        <Route path="/notes/:noteId" element={<NoteDetailView />} />
      </Routes>
    </MemoryRouter>,
  )

const mountDetail = (noteId: string) =>
  render(
    <MemoryRouter initialEntries={[`/notes/${noteId}`]}>
      <Routes>
        <Route path="/notes" element={<NotesView />} />
        <Route path="/notes/:noteId" element={<NoteDetailView />} />
      </Routes>
    </MemoryRouter>,
  )

describe('the list', () => {
  it('shows a skeleton, then the notes', async () => {
    await createNote({ title: 'Binary search' })
    const { container } = mountList()
    // A placeholder is on screen rather than an empty panel. `DataView`'s own
    // test covers the accessible half; this one only needs the shape.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)

    await waitFor(() => expect(screen.getByRole('link', { name: 'Binary search' })).toBeTruthy())
  })

  it('shows the four columns the milestone asks for', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    const task = await taskRepo.create(taskInput())
    const note = await createNote({ title: 'Binary search', tagIds: [tag.id] })
    await attachLink(note.id, 'task', task.id)

    mountList()
    await waitFor(() => expect(screen.getByRole('link', { name: 'Binary search' })).toBeTruthy())

    const row = screen.getByRole('link', { name: 'Binary search' }).closest('[data-note-id]')
    expect(row?.textContent).toContain('dsa')
    // Updated — under a frozen clock the note was written a moment ago.
    expect(row?.textContent).toContain('just now')
    // A link count that is announced, not merely drawn.
    expect(within(row as HTMLElement).getByLabelText('1 linked item')).toBeTruthy()
  })

  it('shows the reserved vault path, because it is a promise M12 must keep', async () => {
    await createNote({ title: 'Binary search' })
    mountList()

    await waitFor(() =>
      expect(screen.getByTitle('notes/binary-search.md')).toBeTruthy(),
    )
  })

  it('titles an untitled note from its body', async () => {
    await createNote({ body: '# Halving the range' })
    mountList()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Halving the range' })).toBeTruthy(),
    )
  })

  it('filters by linked, unlinked and deleted', async () => {
    const task = await taskRepo.create(taskInput())
    const linked = await createNote({ title: 'linked note' })
    await attachLink(linked.id, 'task', task.id)
    await createNote({ title: 'loose note' })
    const gone = await createNote({ title: 'gone note' })
    await deleteNote(gone.id)

    mountList()
    await waitFor(() => expect(screen.getByRole('link', { name: 'loose note' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^Linked\s*1$/ }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'loose note' })).toBeNull())
    expect(screen.getByRole('link', { name: 'linked note' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Unlinked\s*1$/ }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'loose note' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^Deleted\s*1$/ }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'gone note' })).toBeTruthy())
  })

  it('searches titles, body text and tags, live', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'dsa' }))
    await createNote({ title: 'Binary search' })
    await createNote({ title: 'Graphs', body: 'about **adjacency** lists' })
    await createNote({ title: 'Tagged', tagIds: [tag.id] })

    mountList()
    await waitFor(() => expect(screen.getByRole('link', { name: 'Graphs' })).toBeTruthy())

    const box = screen.getByLabelText('Search notes')

    fireEvent.change(box, { target: { value: 'binary' } })
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Graphs' })).toBeNull())

    // Body text is searched through its rendered form, so the delimiters in
    // `**adjacency**` do not get in the way.
    fireEvent.change(box, { target: { value: 'adjacency' } })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Graphs' })).toBeTruthy())

    fireEvent.change(box, { target: { value: 'dsa' } })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Tagged' })).toBeTruthy())
  })

  it('distinguishes no notes at all from nothing matching', async () => {
    mountList()
    expect(await screen.findByText('No notes yet')).toBeTruthy()
  })

  it('deletes softly and puts an undo on the stack', async () => {
    await createNote({ title: 'Doomed' })
    mountList()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Doomed' }))

    await waitFor(() => expect(useToastStore.getState().undoStack.length).toBe(1))
    expect(await listNotes()).toHaveLength(0)
  })

  it('restores a deleted note from the Deleted filter', async () => {
    const note = await createNote({ title: 'Doomed' })
    await deleteNote(note.id)

    mountList()
    fireEvent.click(await screen.findByRole('button', { name: /^Deleted\s*1$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Doomed' }))

    await waitFor(async () => expect(await listNotes()).toHaveLength(1))
  })
})

describe('the editor', () => {
  it('autosaves the body without a save button', async () => {
    const note = await createNote({ title: 'Draft' })
    mountDetail(note.id)

    const area = await screen.findByLabelText('Note body')
    // There is deliberately no button to press.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull()

    fireEvent.change(area, { target: { value: 'written by the test' } })
    fireEvent.blur(area)

    await waitFor(async () => {
      const saved = await db.notes.get(note.id)
      expect(saved?.body).toBe('written by the test')
    })
  })

  it('autosaves the title too', async () => {
    const note = await createNote({ title: 'Before' })
    mountDetail(note.id)

    const input = await screen.findByLabelText('Note title')
    fireEvent.change(input, { target: { value: 'After' } })
    fireEvent.blur(input)

    await waitFor(async () => {
      expect((await db.notes.get(note.id))?.title).toBe('After')
    })
  })

  it('writes nothing when the text is unchanged', async () => {
    const note = await createNote({ title: 'Draft', body: 'same' })
    const before = (await db.events.toArray()).length

    mountDetail(note.id)
    const area = await screen.findByLabelText('Note body')
    fireEvent.change(area, { target: { value: 'same' } })
    fireEvent.blur(area)

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect((await db.events.toArray()).length).toBe(before)
  })

  it('reports its save state instead of a button', async () => {
    const note = await createNote({ title: 'Draft' })
    mountDetail(note.id)

    const area = await screen.findByLabelText('Note body')
    expect(screen.getByRole('status').textContent).toContain('Saved')

    fireEvent.change(area, { target: { value: 'x' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Unsaved'))

    fireEvent.blur(area)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved'))
  })

  it('shows where the note will live in the vault', async () => {
    const note = await createNote({ title: 'Binary search' })
    mountDetail(note.id)

    await waitFor(() => expect(screen.getByText('notes/binary-search.md')).toBeTruthy())
  })

  it('switches between edit, split and preview', async () => {
    const note = await createNote({ title: 'a', body: '# Heading' })
    mountDetail(note.id)

    // Split by default: both panes present.
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(screen.queryByLabelText('Note body')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Heading' })).toBeNull()
  })

  it('says so when the note does not exist', async () => {
    mountDetail('missing')
    expect(await screen.findByText('No such note')).toBeTruthy()
  })
})

describe('markdown rendering', () => {
  const preview = async (body: string) => {
    const note = await createNote({ title: 'a', body })
    const { container } = mountDetail(note.id)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeTruthy())
    return { note, container }
  }

  it('renders headings, emphasis, code and links as real elements', async () => {
    await preview(
      '# Title\n\n**bold** and *italic* and `code`\n\n[docs](https://example.com)\n\n```ts\nconst a = 1\n```',
    )

    expect(screen.getByRole('heading', { name: 'Title', level: 1 })).toBeTruthy()
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')

    const link = screen.getByRole('link', { name: 'docs' })
    expect(link.getAttribute('href')).toBe('https://example.com')
    expect(screen.getByText('const a = 1').tagName).toBe('CODE')
  })

  it('renders an unordered list', async () => {
    await preview('- one\n- two')
    expect(screen.getAllByRole('list').some((node) => node.tagName === 'UL')).toBe(true)
  })

  it('renders an ordered list', async () => {
    await preview('1. one\n2. two')
    expect(screen.getAllByRole('list').some((node) => node.tagName === 'OL')).toBe(true)
  })

  it('renders checkbox lists as checkboxes that can be ticked', async () => {
    const { note } = await preview('- [ ] unchecked\n- [x] checked')

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes[0]?.getAttribute('aria-checked')).toBe('false')
    expect(boxes[1]?.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(boxes[0] as HTMLElement)

    // Ticking rewrites the markdown, so the document stays the source of truth.
    await waitFor(async () => {
      expect((await db.notes.get(note.id))?.body).toBe('- [x] unchecked\n- [x] checked')
    })
  })

  it('never renders user text as markup', async () => {
    // The renderer builds React elements, so this can only become a text node.
    const { container } = await preview('<img src=x onerror="alert(1)"> and <b>not bold</b>')

    // No element was created from the text — those are characters, not tags.
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    // And the characters survive verbatim rather than being silently stripped.
    expect(container.textContent).toContain('<b>not bold</b>')
  })

  it('defuses a link whose scheme would execute', async () => {
    await preview('[click](javascript:alert(1))')
    expect(screen.getByRole('link', { name: 'click' }).getAttribute('href')).toBe('#')
  })
})

describe('linking from the editor', () => {
  it('links a note to a task and offers a route to it', async () => {
    const task = await taskRepo.create(taskInput({ title: 'Study Trees' }))
    const note = await createNote({ title: 'About trees' })
    mountDetail(note.id)

    fireEvent.click(await screen.findByRole('button', { name: 'Link' }))
    fireEvent.change(screen.getByLabelText('Find something to link'), {
      target: { value: 'trees' },
    })
    fireEvent.click(await screen.findByRole('button', { name: /Study Trees/ }))

    const link = await screen.findByRole('link', { name: 'Study Trees' })
    expect(link.getAttribute('href')).toBe(`/tasks?task=${task.id}`)
  })

  it('shows a renamed entity under its new name, with nothing propagated', async () => {
    const task = await taskRepo.create(taskInput({ title: 'Original title' }))
    const note = await createNote({
      title: 'a',
      links: [{ refType: 'task', refId: task.id }],
    })
    mountDetail(note.id)

    await waitFor(() => expect(screen.getByRole('link', { name: 'Original title' })).toBeTruthy())

    await taskRepo.update(task.id, { title: 'Renamed title' })

    await waitFor(() => expect(screen.getByRole('link', { name: 'Renamed title' })).toBeTruthy())
  })

  it('unlinks without deleting the note or the task', async () => {
    const task = await taskRepo.create(taskInput({ title: 'Study Trees' }))
    const note = await createNote({
      title: 'a',
      links: [{ refType: 'task', refId: task.id }],
    })
    mountDetail(note.id)

    fireEvent.click(await screen.findByRole('button', { name: 'Unlink Study Trees' }))

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Study Trees' })).toBeNull(),
    )
    expect(await taskRepo.get(task.id)).toBeDefined()
    expect(await listNotes()).toHaveLength(1)
  })

  it('marks a link whose target is gone rather than hiding it', async () => {
    const task = await taskRepo.create(taskInput({ title: 'Doomed' }))
    const note = await createNote({
      title: 'a',
      links: [{ refType: 'task', refId: task.id }],
    })
    await taskRepo.softDelete(task.id)

    mountDetail(note.id)
    expect(await screen.findByText('Deleted')).toBeTruthy()
  })
})

describe('the event log', () => {
  it('writes nothing merely for looking at a note', async () => {
    const note = await createNote({ title: 'a', body: '# Heading' })
    const before = new Set((await db.events.toArray()).map((event) => event.id))

    mountDetail(note.id)
    await waitFor(() => expect(screen.getByLabelText('Note body')).toBeTruthy())

    const added = (await db.events.toArray()).filter((event) => !before.has(event.id))
    expect(added).toEqual([])
  })
})
