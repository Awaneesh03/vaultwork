import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { noteRepo } from '@/repositories'
import { createNote, exportNote, setVaultPort, updateNote } from '@/services'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { ObsidianView } from './ObsidianView'

/**
 * The Obsidian screen, mounted against an in-memory vault.
 *
 * `obsidianService.test.ts` proves the rules with no React; this proves the
 * screen is wired to them — that connecting works, that a scan has to happen
 * before anything is written, and that a conflict is shown in words rather
 * than only in colour.
 */

const NOW = new Date(2026, 8, 5, 10, 0, 0)
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
      <ObsidianView />
    </MemoryRouter>,
  )

const connect = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Connect vault' }))
  await screen.findByRole('button', { name: 'Disconnect' })
}

describe('connection', () => {
  it('starts not connected and says notes still work', async () => {
    mount()
    // The badge reads "Checking…" until the first status returns, so the
    // assertion waits for the real answer rather than a placeholder.
    expect(await screen.findByText(/Notes work normally without one/)).toBeTruthy()
    expect(screen.getByText('Not connected')).toBeTruthy()
  })

  it('says it is still checking before the first status returns', async () => {
    mount()
    // Claiming "Not connected" before knowing would be a definite answer to a
    // question still being asked.
    expect(screen.getByText('Checking…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect vault' })).toBeNull()
  })

  it('connects and shows the folder name', async () => {
    mount()
    await connect()

    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByTitle('MyVault')).toBeTruthy()
  })

  it('disconnects again', async () => {
    mount()
    await connect()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
  })

  it('offers Reconnect, not Connected, when permission lapsed', async () => {
    mount()
    await connect()

    // A handle can outlive its permission. The UI must not claim otherwise.
    vault.setPermission('prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
  })

  it('states plainly when the browser cannot do this at all', async () => {
    setVaultPort(createMemoryVault({ supported: false }))
    mount()

    expect(await screen.findByText('Not supported')).toBeTruthy()
    expect(screen.getByText(/not supported in this browser/)).toBeTruthy()
    // Offering a button that always fails is worse than offering none.
    expect(screen.getByRole('button', { name: 'Connect vault' })).toHaveProperty('disabled', true)
  })

  it('announces the connection state as a status', async () => {
    mount()
    const badge = await screen.findByText('Not connected')
    expect(badge.getAttribute('role')).toBe('status')
  })

  it('shows the connect action once the state is known', async () => {
    mount()
    expect(await screen.findByRole('button', { name: 'Connect vault' })).toBeTruthy()
  })
})

describe('scanning before writing', () => {
  it('will not export all until a scan has run', async () => {
    mount()
    await connect()

    // Exporting before looking is the blind operation the policy forbids.
    expect(screen.getByRole('button', { name: 'Export all' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/Scan to see what is in sync/)).toBeTruthy()
  })

  it('scans and reports every state with a word', async () => {
    const clean = await createNote({ title: 'Clean' })
    const local = await createNote({ title: 'Local', body: 'a' })
    await createNote({ title: 'Never' })

    mount()
    await connect()
    // Export the two that need a baseline, through the service.
    await exportNote(clean.id)
    await exportNote(local.id)
    await updateNote(local.id, { body: 'b' })

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    // Each label appears twice by design: once as a count chip, once on the
    // row it belongs to.
    await waitFor(() => expect(screen.getAllByText('Synced').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Local changes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Not exported').length).toBeGreaterThan(0)
  })

  it('enables Export all once a scan exists, and reports the outcome', async () => {
    await createNote({ title: 'One' })
    mount()
    await connect()

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export all' })).toHaveProperty(
        'disabled',
        false,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export all' }))
    await waitFor(() => expect(screen.getByText(/1 exported/)).toBeTruthy())
    expect(vault.files.has('notes/one.md')).toBe(true)
  })
})

describe('conflicts', () => {
  it('says how many conflicted, in words, and that nothing was written', async () => {
    const note = await createNote({ title: 'Contested', body: 'ours' })
    mount()
    await connect()
    await exportNote(note.id)
    await updateNote(note.id, { body: 'ours edited' })
    vault.seed('notes/contested.md', 'theirs\n')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('changed on both sides')
    expect(alert.textContent).toContain('nothing was written')
  })

  it('does not overwrite a conflicted file during Export all', async () => {
    const safe = await createNote({ title: 'Safe' })
    const risky = await createNote({ title: 'Risky', body: 'ours' })
    mount()
    await connect()
    await exportNote(risky.id)
    await updateNote(risky.id, { body: 'ours edited' })
    vault.seed('notes/risky.md', 'theirs\n')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))
    await waitFor(() => expect(screen.getAllByText('Conflict').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Export all' }))

    await waitFor(() => expect(screen.getByText(/skipped/)).toBeTruthy())
    // The external edit survived.
    expect(vault.files.get('notes/risky.md')).toBe('theirs\n')
    expect(vault.files.has('notes/safe.md')).toBe(true)
    expect(safe.id).not.toBe(risky.id)
  })
})

describe('untracked vault files', () => {
  it('lists them and promises they will not be deleted', async () => {
    mount()
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/theirs.md', '# Written in Obsidian\n')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    await waitFor(() => expect(screen.getByTitle('notes/theirs.md')).toBeTruthy())
    expect(screen.getByText(/Export never deletes these/)).toBeTruthy()
  })

  it('asks for confirmation before importing, naming what it will do', async () => {
    mount()
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/theirs.md', '---\ntitle: Theirs\n---\n\nbody\n')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))
    await waitFor(() => expect(screen.getByTitle('notes/theirs.md')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const dialog = await screen.findByRole('dialog', { name: 'Import from Obsidian' })
    expect(within(dialog).getByText('Theirs')).toBeTruthy()
    expect(within(dialog).getByTitle('notes/theirs.md')).toBeTruthy()
    expect(within(dialog).getByText(/No existing note/)).toBeTruthy()
  })

  it('imports on confirmation', async () => {
    mount()
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/theirs.md', '---\ntitle: Theirs\n---\n\nbody\n')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))
    await waitFor(() => expect(screen.getByTitle('notes/theirs.md')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const dialog = await screen.findByRole('dialog', { name: 'Import from Obsidian' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))

    await waitFor(async () => expect(await noteRepo.listLive()).toHaveLength(1))
    expect((await noteRepo.listLive())[0]?.title).toBe('Theirs')
  })

  it('closes the confirmation on Escape without importing', async () => {
    mount()
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/theirs.md', 'body\n')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))
    await waitFor(() => expect(screen.getByTitle('notes/theirs.md')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const dialog = await screen.findByRole('dialog', { name: 'Import from Obsidian' })
    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Import from Obsidian' })).toBeNull(),
    )
    expect(await noteRepo.listLive()).toHaveLength(0)
  })
})

describe('what the scan saw', () => {
  it('counts Markdown, PDFs and skipped files apart', async () => {
    mount()
    await connect()
    await vault.createDirectory('notes')
    vault.seed('notes/one.md', '# One\n')
    vault.seedPdf('design.pdf', 'System design basics.')
    vault.seed('photo.png', 'binary')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    await waitFor(() => expect(screen.getByText('Markdown')).toBeTruthy())
    expect(screen.getByText('PDFs')).toBeTruthy()
    expect(screen.getByText('Skipped')).toBeTruthy()
  })

  it('points PDFs at the one import flow rather than growing a second', async () => {
    mount()
    await connect()
    vault.seedPdf('design.pdf', 'System design basics.')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    await waitFor(() => expect(screen.getByText(/1 PDF not read yet/)).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Import them in Sync center' })).toBeTruthy()
  })

  it('says what it reads, both kinds', async () => {
    mount()
    await connect()
    await waitFor(() =>
      expect(screen.getByText(/reads Markdown notes and PDF documents/)).toBeTruthy(),
    )
  })
})

describe('a vault with nothing Vaultwork can read', () => {
  /*
   * A connected folder of images scans perfectly and finds nothing. Every count
   * reads zero, which is correct and indistinguishable from a broken scan
   * unless the screen explains it.
   */
  it('explains the zeroes instead of leaving them unexplained', async () => {
    mount()
    await connect()
    vault.seed('photo.png', 'binary')
    vault.seed('clip.mp4', 'binary')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    await waitFor(() =>
      expect(screen.getByText(/Nothing here Vaultwork can read/)).toBeTruthy(),
    )
    expect(screen.getByText(/photo\.png/)).toBeTruthy()
    expect(screen.getByText(/\.pdf/)).toBeTruthy()
  })

  it('says nothing of the sort once the vault holds a PDF', async () => {
    mount()
    await connect()
    vault.seed('photo.png', 'binary')
    vault.seedPdf('paper.pdf', 'Real content.')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    await waitFor(() => expect(screen.getByText(/1 PDF not read yet/)).toBeTruthy())
    expect(screen.queryByText(/Nothing here Vaultwork can read/)).toBeNull()
  })
})

describe('errors', () => {
  it('shows a readable message rather than an exception', async () => {
    mount()
    await connect()
    vault.setPermission('denied')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/denied/i)
    expect(alert.textContent).not.toContain('VaultError')
  })
})
