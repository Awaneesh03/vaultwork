import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { listNotes } from '@/services'
import { useGlobalShortcuts } from '@/app/shortcuts/useGlobalShortcuts'
import { useNoteUiStore } from '@/store/noteUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { NoteComposerHost } from './NoteComposerHost'

/**
 * Quick capture: Shift+N, from anywhere.
 *
 * The distinction that matters is between `n` and `Shift+N`. Plain `n` has
 * meant "capture a task" since M3, and a note must not steal it — so the two
 * are tested together, on a screen that is neither Notes nor a task list.
 */

const NOW = new Date(2026, 8, 4, 10, 0, 0)

function Harness() {
  useGlobalShortcuts()
  return (
    <>
      <div>some other screen</div>
      <NoteComposerHost />
    </>
  )
}

const mount = (at = '/analytics') =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useNoteUiStore.getState().reset()
  useTaskUiStore.setState({ quickAddOpen: false })
  useToastStore.setState({ toasts: [], undoStack: [] })
})

describe('Shift+N', () => {
  it('opens the note composer from a screen that is not Notes', async () => {
    mount()
    fireEvent.keyDown(window, { key: 'N', shiftKey: true })

    expect(await screen.findByRole('dialog', { name: 'New note' })).toBeTruthy()
  })

  it('does not steal plain N, which still captures a task', async () => {
    mount()
    fireEvent.keyDown(window, { key: 'n' })

    expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull()
    // M3's binding is untouched.
    expect(useTaskUiStore.getState().quickAddOpen).toBe(true)
  })

  it('does nothing while the caret is in a field', async () => {
    mount()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    fireEvent.keyDown(input, { key: 'N', shiftKey: true })
    expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull()

    input.remove()
  })

  it('closes on Escape without writing anything', async () => {
    mount()
    fireEvent.keyDown(window, { key: 'N', shiftKey: true })
    await screen.findByRole('dialog', { name: 'New note' })

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull())
    expect(await listNotes()).toHaveLength(0)
  })

  it('creates a note with a reserved vault path', async () => {
    mount()
    fireEvent.keyDown(window, { key: 'N', shiftKey: true })
    await screen.findByRole('dialog', { name: 'New note' })

    fireEvent.change(screen.getByLabelText('Note title'), {
      target: { value: 'Captured thought' },
    })
    fireEvent.change(screen.getByLabelText('Note body'), {
      target: { value: 'the thought itself' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(async () => {
      const [note] = await listNotes()
      expect(note).toMatchObject({
        title: 'Captured thought',
        body: 'the thought itself',
        vaultPath: 'notes/captured-thought.md',
      })
    })
  })

  it('accepts an empty note, because you may just want somewhere to write', async () => {
    mount()
    fireEvent.keyDown(window, { key: 'N', shiftKey: true })
    await screen.findByRole('dialog', { name: 'New note' })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(async () => expect(await listNotes()).toHaveLength(1))
  })

  it('emits exactly one note.created', async () => {
    mount()
    fireEvent.keyDown(window, { key: 'N', shiftKey: true })
    await screen.findByRole('dialog', { name: 'New note' })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(async () => expect(await listNotes()).toHaveLength(1))

    const events = (await db.events.toArray()).filter((event) => event.entityType === 'note')
    expect(events.map((event) => event.type)).toEqual(['note.created'])
  })

  it('closes the composer after creating', async () => {
    mount()
    fireEvent.keyDown(window, { key: 'N', shiftKey: true })
    await screen.findByRole('dialog', { name: 'New note' })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull())
  })
})
