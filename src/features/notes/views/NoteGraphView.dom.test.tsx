import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { noteRepo, tagRepo } from '@/repositories'
import { createNote, deleteNote } from '@/services'
import { useNoteUiStore } from '@/store/noteUiStore'
import { tagInput } from '../../../../tests/factories'
import { freezeClock, resetDatabase, waitOutsideAct } from '../../../../tests/helpers'
import { NoteDetailView } from './NoteDetailView'
import { NoteGraphView } from './NoteGraphView'
import { NotesView } from './NotesView'

/**
 * The knowledge screens.
 *
 * The service tests prove the derivation; these prove the screens are wired to
 * it — and, most importantly, that looking at any of it writes nothing.
 */

const NOW = new Date(2026, 8, 7, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useNoteUiStore.getState().reset()
  useNoteUiStore.setState({ mode: 'split' })
})

/**
 * The graph's node count, read straight off the SVG's accessible name.
 *
 * A cheap attribute read on purpose: polling with `getByRole` recomputes
 * accessible names across the whole SVG on every tick, which starves the event
 * loop the live query needs in order to deliver.
 */
const graphNodeCount = (container: HTMLElement): number => {
  const label = container.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? ''
  return Number(/(\d+) notes/.exec(label)?.[1] ?? -1)
}

const app = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/notes" element={<NotesView />} />
        <Route path="/notes/graph" element={<NoteGraphView />} />
        <Route path="/notes/:noteId" element={<NoteDetailView />} />
      </Routes>
    </MemoryRouter>,
  )

describe('the graph screen', () => {
  it('says what it is and offers an empty state', async () => {
    app('/notes/graph')
    expect(await screen.findByRole('heading', { name: 'Graph' })).toBeTruthy()
    expect(await screen.findByText(/Nothing to draw/)).toBeTruthy()
  })

  it('draws a node per note and a line per resolved link', async () => {
    await createNote({ title: 'B' })
    await createNote({ title: 'A', body: 'See [[B]].' })

    const { container } = app('/notes/graph')

    await waitFor(() => expect(container.querySelectorAll('circle')).toHaveLength(2))
    expect(container.querySelectorAll('line')).toHaveLength(1)
  })

  it('draws no line for an unresolved link', async () => {
    await createNote({ title: 'A', body: 'See [[Nowhere]].' })
    const { container } = app('/notes/graph')

    await waitFor(() => expect(container.querySelectorAll('circle')).toHaveLength(1))
    expect(container.querySelectorAll('line')).toHaveLength(0)
  })

  it('offers every node as a real button, for keyboard and screen readers', async () => {
    await createNote({ title: 'Binary Search' })
    app('/notes/graph')

    // An SVG scatter plot cannot be tabbed through; the list underneath can.
    const button = await screen.findByRole('button', { name: /Binary Search/ })
    expect(button.textContent).toContain('Binary Search')
  })

  it('describes the graph for a screen reader', async () => {
    await createNote({ title: 'B' })
    await createNote({ title: 'A', body: '[[B]]' })

    app('/notes/graph')
    expect(await screen.findByRole('img', { name: /2 notes, 1 links/ })).toBeTruthy()
  })

  it('filters to orphans', async () => {
    await createNote({ title: 'Lonely Note' })
    await createNote({ title: 'Target Note' })
    await createNote({ title: 'Source Note', body: '[[Target Note]]' })

    const { container } = app('/notes/graph')
    await screen.findByRole('button', { name: /Lonely Note/ })

    fireEvent.click(screen.getByRole('button', { name: 'Orphans' }))
    await waitOutsideAct(() => {
      expect(graphNodeCount(container)).toBe(1)
    })
    expect(screen.queryByRole('button', { name: /Source Note/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Lonely Note/ })).toBeTruthy()
  })

  it('filters to unresolved', async () => {
    await createNote({ title: 'Healthy Note' })
    await createNote({ title: 'Broken Note', body: '[[Nowhere]]' })

    const { container } = app('/notes/graph')
    await screen.findByRole('button', { name: /Healthy Note/ })

    fireEvent.click(screen.getByRole('button', { name: 'Unresolved' }))
    await waitOutsideAct(() => {
      expect(graphNodeCount(container)).toBe(1)
    })
    expect(screen.queryByRole('button', { name: /Healthy Note/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Broken Note/ })).toBeTruthy()
  })

  it('filters by tag', async () => {
    // Titles deliberately unlike the filter chip labels ("Tagged", "Orphans"),
    // so a query for a node cannot match a filter button instead.
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    await createNote({ title: 'Java Note', tagIds: [tag.id] })
    await createNote({ title: 'Plain Note' })

    const { container } = app('/notes/graph')
    await screen.findByRole('button', { name: /Plain Note/ })

    // The tag list is its own live query. Setting a select to a value whose
    // option has not rendered yet is silently ignored by the DOM, which is why
    // the option is waited for rather than assumed.
    const select = screen.getByLabelText('Filter the graph by tag') as HTMLSelectElement
    await waitOutsideAct(() => {
      expect([...select.options].map((option) => option.value)).toContain(tag.id)
    })

    fireEvent.change(select, { target: { value: tag.id } })
    expect(select.value).toBe(tag.id)

    await waitOutsideAct(() => {
      expect(graphNodeCount(container)).toBe(1)
    })
    expect(screen.queryByRole('button', { name: /Plain Note/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Java Note/ })).toBeTruthy()
  })

  it('honours a focused note from the URL', async () => {
    const b = await createNote({ title: 'B' })
    await createNote({ title: 'A', body: '[[B]]' })
    await createNote({ title: 'Far Away' })

    app(`/notes/graph?note=${b.id}`)

    await screen.findByRole('button', { name: /^B\b/ })
    expect(screen.queryByRole('button', { name: /Far Away/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show the whole vault' })).toBeTruthy()
  })

  it('handles a cycle and a self-link without hanging', async () => {
    await createNote({ title: 'A', body: '[[B]]' })
    await createNote({ title: 'B', body: '[[C]]' })
    await createNote({ title: 'C', body: '[[A]] and [[C]]' })

    const { container } = app('/notes/graph')
    await waitFor(() => expect(container.querySelectorAll('circle')).toHaveLength(3))
    // Scoped to the graph's own svg: lucide icons are paths too.
    const graph = container.querySelector('svg[role="img"]') as SVGElement
    expect(graph.querySelectorAll('line')).toHaveLength(3)
    // Three straight edges plus one self-loop, drawn as an arc.
    expect(graph.querySelectorAll('path')).toHaveLength(1)
  })

  it('writes nothing and emits nothing', async () => {
    await createNote({ title: 'Target Note' })
    await createNote({ title: 'Source Note', body: '[[Target Note]]' })

    const notesBefore = await noteRepo.listLive()
    const eventsBefore = new Set((await db.events.toArray()).map((row) => row.id))

    app('/notes/graph')
    await screen.findByRole('button', { name: /Source Note/ })
    fireEvent.click(screen.getByRole('button', { name: 'Orphans' }))
    fireEvent.click(await screen.findByRole('button', { name: 'All' }))

    expect(await noteRepo.listLive()).toEqual(notesBefore)
    const added = (await db.events.toArray()).filter((row) => !eventsBefore.has(row.id))
    expect(added).toEqual([])
  })
})

describe('the note detail knowledge panel', () => {
  it('shows outgoing links and opens the target', async () => {
    const b = await createNote({ title: 'B' })
    const a = await createNote({ title: 'A', body: 'See [[B]].' })

    app(`/notes/${a.id}`)

    await screen.findByText('Outgoing links')
    const section = screen.getByText('Outgoing links').closest('section') as HTMLElement
    const link = within(section).getByRole('link', { name: /^B/ })
    expect(link.getAttribute('href')).toBe(`/notes/${b.id}`)
  })

  it('shows a backlink on the target', async () => {
    const b = await createNote({ title: 'B' })
    await createNote({ title: 'A', body: 'See [[B]].' })

    app(`/notes/${b.id}`)

    await screen.findByText('Backlinks')
    const backlinks = screen.getByText('Backlinks').closest('section') as HTMLElement
    expect(within(backlinks).getByRole('link', { name: 'A' })).toBeTruthy()
  })

  it('reports a deleted target distinctly from a missing one', async () => {
    const b = await createNote({ title: 'B' })
    const a = await createNote({ title: 'A', body: '[[B]] and [[Nowhere]]' })
    await deleteNote(b.id)

    app(`/notes/${a.id}`)

    await screen.findByText('Unresolved')
    expect(screen.getByText('In the trash')).toBeTruthy()
    expect(screen.getByText('No such note')).toBeTruthy()
  })

  it('shows ambiguity with every candidate, and resolves nothing', async () => {
    await createNote({ title: 'Java' })
    await createNote({ title: 'Java' })
    const a = await createNote({ title: 'A', body: '[[Java]]' })

    app(`/notes/${a.id}`)

    await screen.findByText('Ambiguous')
    expect(screen.getByText(/matches 2 notes/)).toBeTruthy()
    // Neither candidate became an outgoing link.
    expect(screen.getByText(/This note links to nothing yet/)).toBeTruthy()
  })

  it('flags a missing heading without calling the note missing', async () => {
    await createNote({ title: 'Target', body: '## Recursion\n' })
    const a = await createNote({ title: 'A', body: '[[Target#Nowhere]]' })

    app(`/notes/${a.id}`)

    expect(await screen.findByText(/no such heading/)).toBeTruthy()
    expect(screen.queryByText('Unresolved')).toBeNull()
  })

  it('links to a heading anchor when the heading exists', async () => {
    const target = await createNote({ title: 'Target', body: '## Recursion\n' })
    const a = await createNote({ title: 'A', body: '[[Target#Recursion]]' })

    app(`/notes/${a.id}`)

    await screen.findByText('Outgoing links')
    const section = screen.getByText('Outgoing links').closest('section') as HTMLElement
    const link = within(section).getByRole('link', { name: /Target/ })
    expect(link.getAttribute('href')).toBe(`/notes/${target.id}#recursion`)
  })

  it('shows related notes with the reason, not just a number', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    await createNote({ title: 'Sibling', tagIds: [tag.id] })
    const a = await createNote({ title: 'A', tagIds: [tag.id] })

    app(`/notes/${a.id}`)

    await screen.findByText('Related')
    expect(screen.getByText('Shares a tag')).toBeTruthy()
    expect(screen.getByLabelText('Relatedness score 2')).toBeTruthy()
  })

  it('explains orphan status instead of drawing an empty graph', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    const lonely = await createNote({ title: 'Lonely', tagIds: [tag.id] })

    app(`/notes/${lonely.id}`)

    expect(await screen.findByText(/an orphan/)).toBeTruthy()
    // Tags do not rescue it.
    expect(screen.getByText(/a tag is a label, a link is a relationship/)).toBeTruthy()
  })
})

describe('the notes list', () => {
  it('offers an Orphans filter that keeps tagged notes', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    await createNote({ title: 'Tagged Orphan', tagIds: [tag.id] })
    await createNote({ title: 'B' })
    await createNote({ title: 'A', body: '[[B]]' })

    app('/notes')
    await screen.findByRole('link', { name: 'Tagged Orphan' })

    fireEvent.click(screen.getByRole('button', { name: /^Orphans\s*1$/ }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'A' })).toBeNull())
    expect(screen.getByRole('link', { name: 'Tagged Orphan' })).toBeTruthy()
  })

  it('accepts ?filter=orphans as an entry point', async () => {
    await createNote({ title: 'Lonely' })
    await createNote({ title: 'B' })
    await createNote({ title: 'A', body: '[[B]]' })

    app('/notes?filter=orphans')

    await waitFor(() => expect(screen.getByRole('link', { name: 'Lonely' })).toBeTruthy())
    expect(screen.queryByRole('link', { name: 'A' })).toBeNull()
  })

  it('accepts ?tag= and shows which tag is applied', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    await createNote({ title: 'Java note', tagIds: [tag.id] })
    await createNote({ title: 'Other note' })

    app(`/notes?tag=${tag.id}`)

    await waitFor(() => expect(screen.getByRole('link', { name: 'Java note' })).toBeTruthy())
    expect(screen.queryByRole('link', { name: 'Other note' })).toBeNull()
    expect(screen.getByText('#java')).toBeTruthy()
  })

  it('links to the graph', async () => {
    app('/notes')
    const link = await screen.findByRole('link', { name: /Graph/ })
    expect(link.getAttribute('href')).toBe('/notes/graph')
  })
})
