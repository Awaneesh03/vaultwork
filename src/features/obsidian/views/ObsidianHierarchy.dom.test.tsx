import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { createNote, exportNote, setVaultPort, updateNote } from '@/services'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { ObsidianView } from './ObsidianView'

/**
 * What the screen puts first, and what it declines to draw at all.
 *
 * `ObsidianView.dom.test.tsx` proves every state is reachable and named. This
 * proves the ordering the redesign is actually about: that the vault you
 * connected is the heading rather than the word "vault", that a state nobody
 * is in is not given a chip, and that the two things which need a decision —
 * an unreadable folder, a conflict — come before the figures they undermine.
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

/** Document order, so "before" is a fact rather than an impression. */
const comesBefore = (first: Element, second: Element): boolean =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('which vault', () => {
  it('makes the connected folder the heading, not the word "vault"', async () => {
    mount()
    await connect()

    // Someone with two vaults cannot tell which one is attached from a
    // heading that reads "Obsidian vault".
    const heading = await screen.findByRole('heading', { name: 'MyVault' })
    expect(heading).toBeTruthy()
  })

  it('keeps the reassurance about working without a vault out of the way once there is one', async () => {
    mount()
    expect(await screen.findByText(/Notes work normally without one/)).toBeTruthy()

    await connect()

    // Still true, no longer worth a paragraph above the work.
    await waitFor(() => expect(screen.queryByText(/Notes work normally without one/)).toBeNull())
  })
})

describe('what is worth drawing', () => {
  it('gives no chip to a state nobody is in', async () => {
    await createNote({ title: 'Never exported' })

    mount()
    await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    await waitFor(() => expect(screen.getAllByText('Not exported').length).toBeGreaterThan(0))
    // Nothing is synced, in conflict, or missing — so those categories are
    // absent rather than sitting there reading zero.
    expect(screen.queryByText('Synced')).toBeNull()
    expect(screen.queryByText('Conflict')).toBeNull()
    expect(screen.queryByText('File missing')).toBeNull()
  })

  it('draws a state as soon as something is in it', async () => {
    const note = await createNote({ title: 'Clean' })

    mount()
    await connect()
    await exportNote(note.id)
    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    await waitFor(() => expect(screen.getAllByText('Synced').length).toBeGreaterThan(0))
  })
})

describe('what comes first', () => {
  it('puts a conflict above the counts it calls into question', async () => {
    const note = await createNote({ title: 'Both', body: 'mine' })

    mount()
    await connect()
    await exportNote(note.id)
    // Both sides move: the one case the sync policy refuses to decide.
    await updateNote(note.id, { body: 'mine, changed' })
    vault.seed('notes/both.md', 'theirs, changed')

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('changed on both sides')

    // The figures are further down the page than the thing that invalidates
    // them, and the banner offers the screen where it can be resolved.
    const markdown = screen.getByText('Markdown')
    expect(comesBefore(alert, markdown)).toBe(true)
    expect(screen.getByRole('link', { name: 'Resolve in Sync center' })).toBeTruthy()
  })

  it('offers scanning as the action until there is a scan, and exporting after', async () => {
    await createNote({ title: 'One' })
    mount()
    await connect()

    // Before a scan the only safe thing to do is look.
    expect(screen.getByRole('button', { name: 'Export all' })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export all' })).toHaveProperty('disabled', false),
    )
  })
})
