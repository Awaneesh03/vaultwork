import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Backlink } from '@/services'
import { BacklinksPanel } from './BacklinksPanel'

/**
 * M18.2 on screen: a linked note says what kind of knowledge it is, and names
 * its Obsidian file — each only when that is true.
 */

const backlink = (overrides: Partial<Backlink> = {}): Backlink => ({
  noteId: 'n1',
  title: 'Database migration',
  excerpt: '',
  updatedAt: 1,
  kind: null,
  obsidianPath: null,
  ...overrides,
})

const mount = (backlinks: Backlink[], heading?: string) =>
  render(
    <MemoryRouter>
      <BacklinksPanel backlinks={backlinks} {...(heading ? { heading } : {})} />
    </MemoryRouter>,
  )

describe('BacklinksPanel knowledge facts', () => {
  it('shows an ordinary, unexported note with neither badge nor file', () => {
    mount([backlink()])
    expect(screen.getByText('Database migration')).toBeTruthy()
    expect(screen.queryByText('Decision')).toBeNull()
    expect(screen.queryByText(/In Obsidian/)).toBeNull()
  })

  it('names the kind of an artifact', () => {
    mount([backlink({ kind: 'decision' })])
    expect(screen.getByText('Decision')).toBeTruthy()
    // A kind alone is not a file.
    expect(screen.queryByText(/In Obsidian/)).toBeNull()
  })

  it('names the Obsidian file once one exists', () => {
    mount([backlink({ kind: 'brief', obsidianPath: 'notes/projects/vaultwork.md' })])
    const line = screen.getByText('In Obsidian · vaultwork.md')
    expect(line.closest('[title]')?.getAttribute('title')).toBe('notes/projects/vaultwork.md')
  })

  it('keeps its old heading unless told otherwise', () => {
    mount([])
    expect(screen.getByText('Linked notes')).toBeTruthy()
  })

  it('reads as the knowledge layer on a project', () => {
    mount([], 'Knowledge')
    expect(screen.getByText('Knowledge')).toBeTruthy()
  })
})
