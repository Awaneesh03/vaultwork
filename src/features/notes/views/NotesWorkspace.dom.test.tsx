import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { createNote } from '@/services'
import { useNoteUiStore } from '@/store/noteUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { NotesView } from './NotesView'

/**
 * Notes as one workspace rather than two pages.
 *
 * `NotesView.dom.test.tsx` proves the list and the editor each do their job.
 * This proves the thing that is new: that they are on screen *together*, that
 * the rail says which note is open, and that the list can be walked from the
 * keyboard rather than tabbed through a link at a time.
 */

const NOW = new Date(2026, 8, 4, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useNoteUiStore.getState().reset()
  useNoteUiStore.setState({ mode: 'split' })
  useToastStore.setState({ toasts: [], undoStack: [] })
})

/** Both routes render the workspace — that is the point of the change. */
const mount = (at: string) =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/notes" element={<NotesView />} />
        <Route path="/notes/:noteId" element={<NotesView />} />
      </Routes>
    </MemoryRouter>,
  )

const rows = (): HTMLAnchorElement[] =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-rail-row]'))

describe('the workspace', () => {
  it('keeps the list on screen while a note is open', async () => {
    await createNote({ title: 'Binary search' })
    const other = await createNote({ title: 'Graphs' })

    mount(`/notes/${other.id}`)

    // The note being edited…
    await waitFor(() => expect(screen.getByLabelText('Note title')).toBeTruthy())
    expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Graphs')
    // …and the rest of the collection, at the same time. Before this redesign
    // opening a note replaced the list with a page carrying a back button.
    expect(screen.getByRole('link', { name: 'Binary search' })).toBeTruthy()
  })

  it('marks the open note in the rail, and only that one', async () => {
    await createNote({ title: 'Binary search' })
    const open = await createNote({ title: 'Graphs' })

    mount(`/notes/${open.id}`)

    await waitFor(() => expect(rows()).toHaveLength(2))
    const current = rows().filter((row) => row.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toBe('Graphs')
  })

  it('says which pane is which when nothing is open', async () => {
    await createNote({ title: 'Binary search' })
    mount('/notes')

    expect(await screen.findByText('Nothing open')).toBeTruthy()
    expect(await screen.findByRole('link', { name: 'Binary search' })).toBeTruthy()
    // No editor, because no note was chosen — an empty textarea here would
    // look like an unsaved note.
    expect(screen.queryByLabelText('Note title')).toBeNull()
  })

  it('opens a note into the pane when its row is clicked', async () => {
    await createNote({ title: 'Binary search' })
    mount('/notes')

    fireEvent.click(await screen.findByRole('link', { name: 'Binary search' }))

    await waitFor(() =>
      expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Binary search'),
    )
    // The rail did not go anywhere.
    expect(screen.getByRole('link', { name: 'Binary search' })).toBeTruthy()
  })

  it('walks the rail with the arrow keys', async () => {
    // Created oldest first; the list is newest first, so this is the order the
    // rail shows them in.
    await createNote({ title: 'third' })
    await createNote({ title: 'second' })
    await createNote({ title: 'first' })

    mount('/notes')
    await waitFor(() => expect(rows()).toHaveLength(3))
    const rail = rows()[0]?.closest('ul') as HTMLUListElement
    expect(rail).toBeTruthy()

    // From nowhere in particular, Down starts at the top rather than doing
    // nothing — the common case is arrowing straight out of the search box.
    fireEvent.keyDown(rail, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows()[0])

    fireEvent.keyDown(rail, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows()[1])

    fireEvent.keyDown(rail, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows()[0])

    // And it does not wrap past either end.
    fireEvent.keyDown(rail, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows()[0])

    fireEvent.keyDown(rail, { key: 'End' })
    expect(document.activeElement).toBe(rows()[2])

    fireEvent.keyDown(rail, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows()[2])

    fireEvent.keyDown(rail, { key: 'Home' })
    expect(document.activeElement).toBe(rows()[0])
  })

  it('leaves keys it does not own alone', async () => {
    await createNote({ title: 'first' })
    mount('/notes')
    await waitFor(() => expect(rows()).toHaveLength(1))

    const rail = rows()[0]?.closest('ul') as HTMLUListElement
    fireEvent.keyDown(rail, { key: 'a' })
    // Typing a letter must not steal focus into the list.
    expect(document.activeElement).not.toBe(rows()[0])
  })
})
