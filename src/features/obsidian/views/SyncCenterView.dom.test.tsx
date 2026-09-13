import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { noteRepo, vaultLinkRepo } from '@/repositories'
import {
  connectVault,
  createNote,
  deleteNote,
  exportNote,
  setVaultPort,
  updateNote,
} from '@/services'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { SyncCenterView } from './SyncCenterView'

/**
 * The Sync Center.
 *
 * The service tests prove the rules with no React; these prove the screen is
 * the workflow — that nothing is chosen for the user, that a confirmation names
 * what will be replaced, and that the result says what actually happened.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)
let vault: MemoryVault

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  vault = createMemoryVault({ name: 'MyVault' })
  setVaultPort(vault)
})

const mount = () =>
  render(
    <MemoryRouter>
      <SyncCenterView />
    </MemoryRouter>,
  )

const seed = async (path: string, contents: string) => {
  await vault.createDirectory(path.split('/').slice(0, -1).join('/'))
  vault.seed(path, contents)
}

const scan = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Scan vault' }))
  await screen.findByRole('button', { name: 'Scan again' })
}

describe('without a vault', () => {
  it('says so and keeps a route back, rather than failing', async () => {
    mount()
    expect(await screen.findByText('Vault unavailable')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to Obsidian' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Scan vault' })).toBeNull()
  })

  it('names an unsupported browser distinctly from a missing vault', async () => {
    setVaultPort(createMemoryVault({ supported: false }))
    mount()
    expect(await screen.findByText('Not supported here')).toBeTruthy()
  })
})

describe('scanning', () => {
  beforeEach(async () => {
    await connectVault()
  })

  it('reads nothing until asked', async () => {
    mount()
    expect(await screen.findByText(/A scan changes nothing/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull()
  })

  it('reports an empty vault as everything matching', async () => {
    mount()
    await scan()
    expect(await screen.findByText('Everything matches')).toBeTruthy()
  })

  it('groups items by state, with what needs deciding expanded', async () => {
    const conflicted = await createNote({ title: 'Contested', body: 'base' })
    await exportNote(conflicted.id)
    await updateNote(conflicted.id, { body: 'ours' })
    vault.seed('notes/contested.md', 'theirs\n')

    const clean = await createNote({ title: 'Settled' })
    await exportNote(clean.id)

    mount()
    await scan()

    expect(await screen.findByRole('link', { name: 'Contested' })).toBeTruthy()
    // The conflict section is open; nothing had to be clicked to see it.
    expect(screen.getByText(/will not choose for you/)).toBeTruthy()
  })

  it('reports what it looked at in the three categories that matter', async () => {
    await seed('notes/one.md', '# One\n')
    vault.seedPdf('papers/design.pdf', 'System design basics.')
    vault.seed('photo.png', 'binary')
    mount()
    await scan()

    // Not "3 files" — that answers nothing when they are three different things.
    expect(await screen.findByText(/1 Markdown · 1 PDF · 1 skipped/)).toBeTruthy()
  })

  it('lists files it could not read, and says they were left alone', async () => {
    await seed('notes/good.md', '# Good\n')
    await seed('notes/bad.md', '# Bad\n')
    vault.failNext('read', new Error('unreadable') as never)

    mount()
    await scan()

    expect(await screen.findByText('Could not be read')).toBeTruthy()
    expect(screen.getByText(/Nothing about them was changed/)).toBeTruthy()
  })
})

describe('a folder of PDFs', () => {
  /*
   * The folder that drove this milestone: a connected vault of scanned PDFs and
   * no Markdown at all. It used to be a dead end the screen could only apologise
   * for. PDFs are documents now, so the same folder produces importable rows.
   */
  beforeEach(async () => {
    await connectVault()
    vault.seedPdf('12e8b18d-970b.pdf', 'Consistent hashing spreads keys.')
    vault.seedPdf('90e6fc5c-970a.pdf', 'A load balancer distributes requests.')
    vault.seed('notes.docx', 'binary')
  })

  it('offers the PDFs for import rather than reporting agreement', async () => {
    mount()
    await scan()

    expect(screen.getByText('PDF documents')).toBeTruthy()
    expect(screen.queryByText('Everything matches')).toBeNull()
    expect(screen.queryByText('Nothing here Vaultwork can read')).toBeNull()
    expect(screen.getAllByRole('radio', { name: /Import/ }).length).toBe(2)
  })

  it('counts them apart from the file it passed over', async () => {
    mount()
    await scan()
    expect(await screen.findByText(/0 Markdown · 2 PDF · 1 skipped/)).toBeTruthy()
  })

  it('never offers to export a PDF, because Vaultwork cannot write one', async () => {
    mount()
    await scan()

    // The whole document action set: import, or leave it. No export side exists.
    const labels = screen.getAllByRole('radio').map((input) => input.getAttribute('value'))
    expect(labels).not.toContain('export')
    expect(labels).not.toContain('keep-local')
    expect(labels).not.toContain('delete-from-vault')
  })
})

describe('a folder with nothing Vaultwork can read', () => {
  beforeEach(async () => {
    await connectVault()
    vault.seed('photo.png', 'binary')
    vault.seed('clip.mp4', 'binary')
    vault.seed('archive.zip', 'binary')
  })

  it('says so rather than claiming everything matches', async () => {
    mount()
    await scan()

    expect(screen.getByText('Nothing here Vaultwork can read')).toBeTruthy()
    expect(screen.queryByText('Everything matches')).toBeNull()
  })

  it('names what it passed over and what it does read', async () => {
    mount()
    await scan()

    expect(screen.getByText(/3 files here/)).toBeTruthy()
    expect(screen.getByText(/photo\.png/)).toBeTruthy()
    expect(screen.getByText(/reads \.md and \.pdf/)).toBeTruthy()
  })

  it('offers the way out, which is picking a different folder', async () => {
    mount()
    await scan()
    expect(screen.getByRole('link', { name: 'Choose a different folder' })).toBeTruthy()
  })

  it('stops saying it once the folder holds something readable', async () => {
    vault.seedPdf('paper.pdf', 'Real content.')
    mount()
    await scan()

    expect(screen.queryByText('Nothing here Vaultwork can read')).toBeNull()
    expect(screen.getByText('PDF documents')).toBeTruthy()
  })
})

describe('deciding', () => {
  beforeEach(async () => {
    await connectVault()
  })

  it('starts every item on Skip and disables Apply', async () => {
    const note = await createNote({ title: 'Changed', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    mount()
    await scan()

    const skip = await screen.findByRole('radio', { name: 'Skip' })
    expect(skip.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: /^Apply 0/ })).toHaveProperty('disabled', true)
  })

  it('offers both sides of a conflict and neither by default', async () => {
    const note = await createNote({ title: 'Contested', body: 'base' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'ours' })
    vault.seed('notes/contested.md', 'theirs\n')

    mount()
    await scan()

    const keepLocal = await screen.findByRole('radio', { name: /Keep Vaultwork/ })
    const keepExternal = screen.getByRole('radio', { name: /Keep Obsidian/ })
    expect(keepLocal.getAttribute('aria-checked')).toBe('false')
    expect(keepExternal.getAttribute('aria-checked')).toBe('false')
    // There is no automatic resolution anywhere on the screen.
    expect(screen.queryByRole('radio', { name: /auto/i })).toBeNull()
  })

  it('selects only safe changes, never a conflict', async () => {
    const safe = await createNote({ title: 'Safe', body: 'a' })
    await exportNote(safe.id)
    await updateNote(safe.id, { body: 'b' })

    const risky = await createNote({ title: 'Risky', body: 'base' })
    await exportNote(risky.id)
    await updateNote(risky.id, { body: 'ours' })
    vault.seed('notes/risky.md', 'theirs\n')

    mount()
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Select safe changes' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^Apply 1/ })).toBeTruthy())
    const conflictRow = screen.getByRole('link', { name: 'Risky' }).closest('li') as HTMLElement
    expect(
      within(conflictRow).getByRole('radio', { name: 'Skip' }).getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('says nothing can be done for an identity problem', async () => {
    const note = await createNote({ title: 'Original' })
    await exportNote(note.id)
    await seed('notes/copy.md', vault.files.get('notes/original.md') as string)

    mount()
    await scan()

    expect(await screen.findByText(/Nothing can be done safely here/)).toBeTruthy()
  })
})

describe('confirming and applying', () => {
  beforeEach(async () => {
    await connectVault()
  })

  it('summarises before writing anything', async () => {
    const note = await createNote({ title: 'Changed', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    mount()
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Select safe changes' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Apply 1/ }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Apply these changes' })
    expect(within(dialog).getByText('Export')).toBeTruthy()
    // Still nothing written.
    expect(vault.files.get('notes/changed.md')).toContain('a')
  })

  it('names how many choices replace content', async () => {
    const note = await createNote({ title: 'Contested', body: 'base' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'ours' })
    vault.seed('notes/contested.md', 'theirs\n')

    mount()
    await scan()
    fireEvent.click(await screen.findByRole('radio', { name: /Keep Vaultwork/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Apply 1/ }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Apply these changes' })
    expect(within(dialog).getByRole('alert').textContent).toContain('replace content')
  })

  it('cancels without writing', async () => {
    const note = await createNote({ title: 'Changed', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    mount()
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Select safe changes' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Apply 1/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: 'Apply these changes' })).toBeNull(),
    )
    expect(vault.files.get('notes/changed.md')).toContain('a')
  })

  it('applies and reports what actually happened', async () => {
    const note = await createNote({ title: 'Changed', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    mount()
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Select safe changes' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Apply 1/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(screen.getByText(/1 exported/)).toBeTruthy())
    expect(vault.files.get('notes/changed.md')).toContain('b')
    // Never a vague "everything synced".
    expect(screen.queryByText(/Everything synced/)).toBeNull()
  })

  it('reports an item that went stale rather than overwriting it', async () => {
    const note = await createNote({ title: 'Changed', body: 'a' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'b' })

    mount()
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Select safe changes' }))

    // Obsidian saves while the user is deciding.
    vault.seed('notes/changed.md', 'written after the scan\n')

    fireEvent.click(await screen.findByRole('button', { name: /^Apply 1/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(screen.getByText(/changed since the scan/)).toBeTruthy())
    expect(vault.files.get('notes/changed.md')).toBe('written after the scan\n')
  })

  it('imports a new file and creates the note', async () => {
    await seed('notes/theirs.md', '---\ntitle: Theirs\n---\n\nhand written\n')

    mount()
    await scan()
    fireEvent.click(await screen.findByRole('radio', { name: 'Import' }))
    fireEvent.click(screen.getByRole('button', { name: /^Apply 1/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    await waitFor(async () => expect(await noteRepo.listLive()).toHaveLength(1))
    expect((await noteRepo.listLive())[0]?.title).toBe('Theirs')
  })

  it('never deletes a note because its file vanished', async () => {
    const note = await createNote({ title: 'Gone' })
    await exportNote(note.id)
    vault.files.delete('notes/gone.md')

    mount()
    await scan()

    // The label appears twice by design: once on the section, once on the row.
    await waitFor(() => expect(screen.getAllByText('File missing').length).toBeGreaterThan(0))
    // The offered actions are to write it again or stop tracking — never to
    // delete the note.
    expect(screen.getByRole('radio', { name: /Write it again/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Forget the link/ })).toBeTruthy()
    expect(await noteRepo.get(note.id)).toBeDefined()
  })

  it('forgets a link without touching the note', async () => {
    const note = await createNote({ title: 'Gone' })
    await exportNote(note.id)
    vault.files.delete('notes/gone.md')

    mount()
    await scan()
    fireEvent.click(await screen.findByRole('radio', { name: /Forget the link/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Apply 1/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    await waitFor(async () =>
      expect(await vaultLinkRepo.forEntity('note', note.id)).toBeUndefined(),
    )
    expect(await noteRepo.get(note.id)).toBeDefined()
  })

  it('never deletes a vault file because the note was deleted', async () => {
    const note = await createNote({ title: 'Doomed' })
    await exportNote(note.id)
    await deleteNote(note.id)

    mount()
    await scan()

    await waitFor(() => expect(screen.getAllByText('Deleted here').length).toBeGreaterThan(0))
    expect(vault.files.has('notes/doomed.md')).toBe(true)
  })
})

describe('comparing a conflict', () => {
  beforeEach(async () => {
    await connectVault()
  })

  it('shows both versions and offers no merge', async () => {
    const note = await createNote({ title: 'Contested', body: 'line one\nours\nline three' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'line one\nours edited\nline three' })
    vault.seed(
      'notes/contested.md',
      `---\nid: "${note.id}"\ntitle: Contested\n---\n\nline one\ntheirs\nline three\n`,
    )

    mount()
    await scan()
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))

    const dialog = await screen.findByRole('dialog', { name: /Compare Contested/ })
    expect(within(dialog).getByText('ours edited')).toBeTruthy()
    expect(within(dialog).getByText('theirs')).toBeTruthy()
    expect(within(dialog).getByText(/will not combine these/)).toBeTruthy()
    // Two named choices, and no third "merge" option.
    expect(within(dialog).getByRole('button', { name: 'Keep Vaultwork' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Keep Obsidian' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /merge/i })).toBeNull()
  })

  it('stages the choice rather than applying it immediately', async () => {
    const note = await createNote({ title: 'Contested', body: 'ours' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'ours edited' })
    vault.seed('notes/contested.md', 'theirs\n')

    mount()
    await scan()
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep Vaultwork' }))

    // The decision is staged; the file is untouched until Apply.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Apply 1/ })).toBeTruthy())
    expect(vault.files.get('notes/contested.md')).toBe('theirs\n')
  })

  it('closes on Escape', async () => {
    const note = await createNote({ title: 'Contested', body: 'ours' })
    await exportNote(note.id)
    await updateNote(note.id, { body: 'ours edited' })
    vault.seed('notes/contested.md', 'theirs\n')

    mount()
    await scan()
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
    const dialog = await screen.findByRole('dialog', { name: /Compare Contested/ })
    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Compare Contested/ })).toBeNull(),
    )
  })
})
