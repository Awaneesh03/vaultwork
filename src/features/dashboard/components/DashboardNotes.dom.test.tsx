import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { taskRepo } from '@/repositories'
import { createNote, deleteNote, getDashboard, getRecentNotes, updateNote } from '@/services'
import { taskInput } from '../../../../tests/factories'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { DashboardNotes } from './DashboardNotes'

/**
 * The Dashboard's recent notes card.
 *
 * The property under test is agreement: the card reads the same service the
 * Notes screen does, so a second implementation of "recent" cannot appear.
 */

const NOW = new Date(2026, 8, 4, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const mount = async () => {
  const data = await getDashboard()
  render(
    <MemoryRouter>
      <DashboardNotes notes={data.notes} now={data.now} today={data.today} />
    </MemoryRouter>,
  )
  return data
}

describe('the card', () => {
  it('shows the same notes the service reports', async () => {
    await createNote({ title: 'Binary search', body: '# Halve it' })
    const data = await mount()

    expect(data.notes).toEqual(await getRecentNotes())
    expect(screen.getByRole('link', { name: /Binary search/ })).toBeTruthy()
  })

  it('links each note straight to its editor', async () => {
    const note = await createNote({ title: 'Binary search' })
    await mount()

    expect(screen.getByRole('link', { name: /Binary search/ }).getAttribute('href')).toBe(
      `/notes/${note.id}`,
    )
  })

  it('shows the five most recently edited, newest first', async () => {
    for (const title of ['a', 'b', 'c', 'd', 'e', 'f']) await createNote({ title })
    const data = await mount()

    expect(data.notes).toHaveLength(5)
    expect(screen.getAllByRole('link').map((node) => node.textContent?.slice(0, 1))[0]).toBe('f')
    // The oldest fell off the end.
    expect(screen.queryByRole('link', { name: /^a/ })).toBeNull()
  })

  it('ranks by edit time, not creation time', async () => {
    const first = await createNote({ title: 'first' })
    await createNote({ title: 'second' })
    await updateNote(first.id, { body: 'edited' })

    const data = await mount()
    expect(data.notes[0]?.title).toBe('first')
  })

  it('excludes deleted notes', async () => {
    const note = await createNote({ title: 'gone' })
    await deleteNote(note.id)
    await mount()

    expect(screen.queryByRole('link', { name: /gone/ })).toBeNull()
    expect(screen.getByText(/No notes yet/)).toBeTruthy()
  })

  it('announces a link count rather than only drawing one', async () => {
    const task = await taskRepo.create(taskInput())
    await createNote({ title: 'a', links: [{ refType: 'task', refId: task.id }] })
    await mount()

    expect(screen.getByLabelText('1 linked item')).toBeTruthy()
  })

  it('is harmless with no notes at all', async () => {
    await mount()
    expect(screen.getByText(/No notes yet/)).toBeTruthy()
  })
})
