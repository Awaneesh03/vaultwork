import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createNote } from '@/services'
import { useNoteUiStore } from '@/store/noteUiStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { NoteGraphView } from './NoteGraphView'

/**
 * The column beside the plot.
 *
 * `NoteGraphView.dom.test.tsx` proves the picture is right — a node per note, a
 * line per resolved link, and the filters that narrow both. This proves the
 * part the redesign added: that clicking a node answers a question about it,
 * that the answer is read off the same edges that were drawn, and that walking
 * to a neighbour continues the exploration rather than ending it.
 */

const NOW = new Date(2026, 8, 4, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useNoteUiStore.getState().reset()
})

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/notes/graph']}>
      <Routes>
        <Route path="/notes/graph" element={<NoteGraphView />} />
      </Routes>
    </MemoryRouter>,
  )

/** The panel a heading names, so assertions cannot drift into a neighbour. */
const panel = (label: string): HTMLElement =>
  screen.getByText(label).closest('section') as HTMLElement

describe('with nothing selected', () => {
  it('describes the vault rather than showing an empty panel', async () => {
    await createNote({ title: 'Lonely' })
    await createNote({ title: 'Target' })
    await createNote({ title: 'Source', body: 'See [[Target]].' })

    mount()

    await screen.findByText('This view')
    const view = panel('This view')
    // Three notes, one of which is attached to nothing in either direction.
    expect(within(view).getByText('Connected').nextSibling?.textContent).toBe('2')
    expect(within(view).getByText('Orphans').nextSibling?.textContent).toBe('1')
    expect(within(view).getByText('Unresolved links').nextSibling?.textContent).toBe('0')
  })

  it('counts a link that points nowhere as unresolved, not as a line', async () => {
    await createNote({ title: 'Broken', body: 'See [[Nowhere]].' })
    mount()

    await screen.findByText('This view')
    expect(within(panel('This view')).getByText('Unresolved links').nextSibling?.textContent).toBe(
      '1',
    )
  })

  it('ranks the most connected notes, and links to them', async () => {
    await createNote({ title: 'Hub' })
    await createNote({ title: 'One', body: 'See [[Hub]].' })
    await createNote({ title: 'Two', body: 'See [[Hub]].' })

    mount()

    await screen.findByText('Most connected')
    const list = panel('Most connected')
    const first = within(list).getAllByRole('link')[0]
    expect(first?.textContent).toContain('Hub')
    expect(first?.getAttribute('href')).toBeTruthy()
  })

  it('says what to write when nothing is linked at all', async () => {
    await createNote({ title: 'Alone' })
    mount()
    expect(await screen.findByText(/Nothing here links to anything yet/)).toBeTruthy()
  })
})

describe('selecting a node', () => {
  it('reports what it reaches and what reaches it', async () => {
    await createNote({ title: 'Target' })
    await createNote({ title: 'Source', body: 'See [[Target]].' })

    mount()

    fireEvent.click(await screen.findByRole('button', { name: /^Source/ }))

    await screen.findByText('Selected')
    expect(within(panel('Selected')).getByRole('link', { name: 'Source' })).toBeTruthy()

    // Read off the drawn edges: Source → Target, and nothing the other way.
    expect(within(panel('Links to')).getByRole('button', { name: /Target/ })).toBeTruthy()
    expect(within(panel('Linked from')).getByText('Nothing links here.')).toBeTruthy()
  })

  it('walks to a neighbour without leaving the graph', async () => {
    await createNote({ title: 'Target' })
    await createNote({ title: 'Source', body: 'See [[Target]].' })

    mount()
    fireEvent.click(await screen.findByRole('button', { name: /^Source/ }))
    await screen.findByText('Selected')

    fireEvent.click(within(panel('Links to')).getByRole('button', { name: /Target/ }))

    // The selection moved; the screen did not.
    await waitFor(() =>
      expect(within(panel('Selected')).getByRole('link', { name: 'Target' })).toBeTruthy(),
    )
    expect(within(panel('Linked from')).getByRole('button', { name: /Source/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Graph' })).toBeTruthy()
  })

  it('writes nothing while being explored', async () => {
    await createNote({ title: 'Target' })
    await createNote({ title: 'Source', body: 'See [[Target]].' })
    const before = (await db.events.toArray()).length

    mount()
    fireEvent.click(await screen.findByRole('button', { name: /^Source/ }))
    await screen.findByText('Selected')
    fireEvent.click(within(panel('Links to')).getByRole('button', { name: /Target/ }))
    await screen.findByText('Linked from')

    expect((await db.events.toArray()).length).toBe(before)
  })
})
