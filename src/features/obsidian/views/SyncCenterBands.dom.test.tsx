import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { connectVault, createNote, exportNote, setVaultPort, updateNote } from '@/services'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { SyncCenterView } from './SyncCenterView'

/**
 * How the Sync Center separates what it can do from what it will not.
 *
 * `SyncCenterView.dom.test.tsx` proves the workflow: nothing chosen for the
 * user, a confirmation that names what is replaced, a result that says what
 * happened. This proves the grouping the redesign added — that a conflict and
 * a queued export are not presented as the same kind of row, and that what is
 * currently staged can be read before the dialog is opened.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)
let vault: MemoryVault

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  vault = createMemoryVault({ name: 'MyVault' })
  setVaultPort(vault)
  await connectVault()
})

const mount = () =>
  render(
    <MemoryRouter>
      <SyncCenterView />
    </MemoryRouter>,
  )

const scan = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Scan vault' }))
  await screen.findByRole('button', { name: 'Scan again' })
}

/** The band a heading names, so an assertion cannot drift into its neighbour. */
const band = (label: string): HTMLElement =>
  screen.getByRole('heading', { name: label }).closest('section') as HTMLElement

/** A note whose two sides both moved — the case Vaultwork refuses to decide. */
const seedConflict = async (title: string, path: string) => {
  const note = await createNote({ title, body: 'base' })
  await exportNote(note.id)
  await updateNote(note.id, { body: 'ours' })
  vault.seed(path, 'theirs\n')
  return note
}

describe('grouping', () => {
  it('separates a conflict from a change it can simply apply', async () => {
    await seedConflict('Contested', 'notes/contested.md')

    const queued = await createNote({ title: 'Queued', body: 'a' })
    await exportNote(queued.id)
    await updateNote(queued.id, { body: 'b' })

    mount()
    await scan()

    await screen.findByRole('heading', { name: 'Needs your decision' })

    // The one nobody but the user can settle…
    expect(
      within(band('Needs your decision')).getByRole('link', { name: 'Contested' }),
    ).toBeTruthy()
    // …and the one that is only waiting to be told to go.
    expect(within(band('Ready to apply')).getByRole('link', { name: 'Queued' })).toBeTruthy()
  })

  it('says in words that it will not choose, rather than only colouring the band', async () => {
    await seedConflict('Contested', 'notes/contested.md')

    mount()
    await scan()

    const heading = await screen.findByRole('heading', { name: 'Needs your decision' })
    expect(
      // The band itself says so, not only the rows inside it — the grouping
      // has to be legible before anything is expanded.
      within(heading.closest('section') as HTMLElement).getByText(
        /will not choose between two versions/,
      ),
    ).toBeTruthy()
  })

  it('shows no band for a group with nothing in it', async () => {
    const queued = await createNote({ title: 'Queued', body: 'a' })
    await exportNote(queued.id)
    await updateNote(queued.id, { body: 'b' })

    mount()
    await scan()

    await screen.findByRole('heading', { name: 'Ready to apply' })
    // A heading over an empty region reads as a scan that failed halfway.
    expect(screen.queryByRole('heading', { name: 'Needs your decision' })).toBeNull()
  })

  it('keeps agreement visible but collapsed', async () => {
    const settled = await createNote({ title: 'Settled' })
    await exportNote(settled.id)

    mount()
    await scan()

    // The band is on screen — "nothing to do" is an answer worth seeing…
    await screen.findByRole('heading', { name: 'Already in agreement' })
    // …but the rows behind it are not, until asked for.
    expect(screen.queryByRole('link', { name: 'Settled' })).toBeNull()

    fireEvent.click(within(band('Already in agreement')).getByRole('button', { expanded: false }))
    expect(await screen.findByRole('link', { name: 'Settled' })).toBeTruthy()
  })
})

describe('what is staged', () => {
  it('says nothing while nothing is chosen', async () => {
    const queued = await createNote({ title: 'Queued', body: 'a' })
    await exportNote(queued.id)
    await updateNote(queued.id, { body: 'b' })

    mount()
    await scan()

    await waitFor(() => expect(screen.getByRole('button', { name: /^Apply 0/ })).toBeTruthy())
    expect(screen.queryByText('Staged')).toBeNull()
  })

  it('breaks the total down by what will actually happen', async () => {
    const queued = await createNote({ title: 'Queued', body: 'a' })
    await exportNote(queued.id)
    await updateNote(queued.id, { body: 'b' })

    mount()
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Select safe changes' }))

    const staged = (await screen.findByText('Staged')).closest('p') as HTMLElement
    // "Apply 1" does not say whether that one is an export or a deletion.
    expect(staged.textContent).toContain('1 export')
    expect(staged.textContent).toContain('Nothing is written until you apply.')
  })

  it('names separately the choices that destroy something', async () => {
    await seedConflict('Contested', 'notes/contested.md')

    mount()
    await scan()
    fireEvent.click(await screen.findByRole('radio', { name: /Keep Vaultwork/ }))

    const staged = (await screen.findByText('Staged')).closest('p') as HTMLElement
    expect(staged.textContent).toContain('replaces content')
    // And still nothing has been written.
    expect(vault.files.get('notes/contested.md')).toBe('theirs\n')
  })
})
