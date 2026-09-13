import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { noteRepo } from '@/repositories'
import { connectVault, createNote, setVaultPort, updateNote } from '@/services'
import { useNoteUiStore } from '@/store/noteUiStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { NoteDetailView } from '@/features/notes/views/NoteDetailView'

/**
 * The Obsidian section on a note.
 *
 * Mounted inside the real note detail screen rather than in isolation, because
 * the thing worth proving is the wiring: that a button on this page reaches a
 * filesystem through the service and nothing else.
 */

const NOW = new Date(2026, 8, 5, 10, 0, 0)
let vault: MemoryVault

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useNoteUiStore.getState().reset()
  useNoteUiStore.setState({ mode: 'split' })
  vault = createMemoryVault({ name: 'MyVault' })
  setVaultPort(vault)
})

const mount = (noteId: string) =>
  render(
    <MemoryRouter initialEntries={[`/notes/${noteId}`]}>
      <Routes>
        <Route path="/notes/:noteId" element={<NoteDetailView />} />
      </Routes>
    </MemoryRouter>,
  )

describe('with no vault connected', () => {
  it('explains rather than offering actions that would fail', async () => {
    const note = await createNote({ title: 'A note' })
    mount(note.id)

    expect(await screen.findByText(/No vault connected/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  })

  it('leaves the note fully editable', async () => {
    const note = await createNote({ title: 'A note' })
    mount(note.id)

    // Dexie is the source of truth; a missing vault changes nothing here.
    const area = await screen.findByLabelText('Note body')
    fireEvent.change(area, { target: { value: 'still works' } })
    fireEvent.blur(area)

    await waitFor(async () =>
      expect((await noteRepo.getOrThrow(note.id)).body).toBe('still works'),
    )
  })
})

describe('with a vault connected', () => {
  beforeEach(async () => {
    await connectVault()
  })

  it('shows the status and the reserved path', async () => {
    const note = await createNote({ title: 'Binary Search' })
    mount(note.id)

    expect(await screen.findByText('Not exported')).toBeTruthy()
    expect(screen.getByTitle('notes/binary-search.md')).toBeTruthy()
  })

  it('exports on demand and then reads as synced', async () => {
    const note = await createNote({ title: 'A note', body: '# Body\n' })
    mount(note.id)

    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))

    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy())
    expect(vault.files.get('notes/a-note.md')).toContain('# Body')
  })

  it('shows a local change after editing', async () => {
    const note = await createNote({ title: 'A note', body: 'first' })
    mount(note.id)
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))
    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy())

    await updateNote(note.id, { body: 'second' })
    fireEvent.click(screen.getByLabelText('Check the vault file again'))

    await waitFor(() => expect(screen.getByText('Local changes')).toBeTruthy())
  })

  it('requires confirmation before replacing an external change', async () => {
    const note = await createNote({ title: 'A note', body: 'ours' })
    mount(note.id)
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))
    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy())

    vault.seed('notes/a-note.md', 'theirs\n')
    fireEvent.click(screen.getByLabelText('Check the vault file again'))
    await waitFor(() => expect(screen.getByText('Changed in Obsidian')).toBeTruthy())

    // The button now names its consequence rather than saying "Export".
    fireEvent.click(screen.getByRole('button', { name: /Export, replacing vault/ }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Replace the vault file' })
    expect(dialog.textContent).toContain('replaces them')
    // Nothing written yet.
    expect(vault.files.get('notes/a-note.md')).toBe('theirs\n')

    fireEvent.click(screen.getByRole('button', { name: 'Replace vault file' }))
    await waitFor(() => expect(vault.files.get('notes/a-note.md')).toContain('ours'))
  })

  it('cancels the confirmation without writing', async () => {
    const note = await createNote({ title: 'A note', body: 'ours' })
    mount(note.id)
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))
    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy())

    vault.seed('notes/a-note.md', 'theirs\n')
    fireEvent.click(screen.getByLabelText('Check the vault file again'))
    await waitFor(() => expect(screen.getByText('Changed in Obsidian')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Export, replacing vault/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: 'Replace the vault file' })).toBeNull(),
    )
    expect(vault.files.get('notes/a-note.md')).toBe('theirs\n')
  })

  it('describes a conflict in words, not only in colour', async () => {
    const note = await createNote({ title: 'A note', body: 'base' })
    mount(note.id)
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))
    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy())

    await updateNote(note.id, { body: 'ours' })
    vault.seed('notes/a-note.md', 'theirs\n')
    fireEvent.click(screen.getByLabelText('Check the vault file again'))

    await waitFor(() => expect(screen.getByText('Conflict')).toBeTruthy())
    expect(screen.getByText(/will not choose for you/)).toBeTruthy()
  })

  it('imports the vault version on confirmation', async () => {
    const note = await createNote({ title: 'A note', body: 'ours' })
    mount(note.id)
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))
    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy())

    vault.seed('notes/a-note.md', `---\nid: "${note.id}"\ntitle: A note\n---\n\ntheirs\n`)
    fireEvent.click(screen.getByLabelText('Check the vault file again'))
    await waitFor(() => expect(screen.getByText('Changed in Obsidian')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace note' }))

    await waitFor(async () =>
      expect((await noteRepo.getOrThrow(note.id)).body).toContain('theirs'),
    )
  })

  it('offers to move the file when the title no longer matches the path', async () => {
    const note = await createNote({ title: 'Before' })
    mount(note.id)
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))
    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy())

    await updateNote(note.id, { title: 'After' })

    const move = await screen.findByRole('button', { name: 'Move file' })
    fireEvent.click(move)

    await waitFor(() => expect(vault.files.has('notes/after.md')).toBe(true))
    // The old file is gone and the note points at the new one.
    expect(vault.files.has('notes/before.md')).toBe(false)
    expect((await noteRepo.getOrThrow(note.id)).vaultPath).toBe('notes/after.md')
  })

  it('requires confirmation before deleting the vault file', async () => {
    const note = await createNote({ title: 'A note' })
    mount(note.id)
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))
    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete the vault file' })
    expect(dialog.textContent).toContain('The note stays in Vaultwork')
    expect(vault.files.has('notes/a-note.md')).toBe(true)

    // The confirm button names its consequence, so it is distinguishable from
    // the trigger — for a screen reader as much as for this test.
    fireEvent.click(screen.getByRole('button', { name: 'Delete from vault' }))
    await waitFor(() => expect(vault.files.has('notes/a-note.md')).toBe(false))
    // The note itself survived.
    expect(await noteRepo.get(note.id)).toBeDefined()
  })

  it('reports a permission failure in words', async () => {
    const note = await createNote({ title: 'A note' })
    mount(note.id)
    await screen.findByRole('button', { name: 'Export' })

    vault.setPermission('denied')
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/denied/i)
  })
})
