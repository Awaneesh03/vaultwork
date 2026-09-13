import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { vaultDocumentRepo } from '@/repositories'
import { createNote } from '@/services'
import type { VaultDocument } from '@/types/entities'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { DocumentsView } from './DocumentsView'

/**
 * The Documents screen.
 *
 * `pdfDocuments.test.ts` proves the pipeline with no React: that a PDF becomes
 * a VaultDocument rather than a Note, and that its text is searchable. This
 * proves the screen shows what that pipeline produced — including the text
 * itself, which the old screen indexed, counted, searched, and never once
 * displayed.
 *
 * Nothing here runs an extractor. Extraction happens in Rust at import time
 * behind `catch_unwind`; these documents are seeded already-extracted, exactly
 * as they would be found in Dexie afterwards.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const seedDocument = (
  overrides: Partial<Omit<VaultDocument, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> = {},
) =>
  vaultDocumentRepo.create({
    title: 'Design Basics',
    vaultPath: 'papers/design.pdf',
    kind: 'pdf',
    text: 'Partitioning is the first idea.',
    extraction: 'ok',
    chars: 30,
    bytes: 240_128,
    hash: 'h1',
    importedAt: NOW.getTime(),
    ...overrides,
  })

const mount = () =>
  render(
    <MemoryRouter>
      <DocumentsView />
    </MemoryRouter>,
  )

describe('the shelf', () => {
  it('offers a route to the one import flow when there is nothing yet', async () => {
    mount()
    expect(await screen.findByText('No documents yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Sync center' })).toBeTruthy()
  })

  it('lists a document with its path and size', async () => {
    await seedDocument()
    mount()

    const row = await screen.findByRole('button', { name: /Design Basics/ })
    expect(row.textContent).toContain('papers/design.pdf')
    // 240,128 bytes is a quarter of a megabyte, not "240128".
    expect(row.textContent).toContain('235 KB')
  })

  it('marks a document with no text layer before it is opened', async () => {
    await seedDocument({ title: 'Scanned', text: '', extraction: 'empty', chars: 0 })
    mount()

    // Otherwise it looks like every other row until the reader comes up empty,
    // and the emptiness reads as a failure of this screen.
    const row = await screen.findByRole('button', { name: /Scanned/ })
    expect(row.textContent).toContain('No text layer')
  })

  it('says which pane is which before anything is chosen', async () => {
    await seedDocument()
    mount()
    expect(await screen.findByText('Nothing open')).toBeTruthy()
  })
})

describe('reading a document', () => {
  it('shows the extracted text, not merely a count of it', async () => {
    await seedDocument({ text: 'Partitioning is the first idea.', chars: 30 })
    mount()

    fireEvent.click(await screen.findByRole('button', { name: /Design Basics/ }))

    expect(await screen.findByText('Partitioning is the first idea.')).toBeTruthy()
  })

  it('states the metadata beside the text', async () => {
    await seedDocument()
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Design Basics/ }))

    const article = (await screen.findByRole('article')) as HTMLElement
    expect(within(article).getByText('Size')).toBeTruthy()
    expect(within(article).getByText('30 characters')).toBeTruthy()
    expect(within(article).getByText('Read')).toBeTruthy()
    // The kind is a word, never colour alone.
    expect(within(article).getByText('PDF')).toBeTruthy()
  })

  it('marks the open document in the shelf, and only that one', async () => {
    await seedDocument({ title: 'First', vaultPath: 'a.pdf', hash: 'a' })
    await seedDocument({ title: 'Second', vaultPath: 'b.pdf', hash: 'b' })
    mount()

    fireEvent.click(await screen.findByRole('button', { name: /Second/ }))

    await waitFor(() => {
      const current = Array.from(
        document.querySelectorAll('aside button[aria-current="true"]'),
      ) as HTMLElement[]
      expect(current).toHaveLength(1)
      expect(current[0]?.textContent).toContain('Second')
    })
  })

  it('explains an empty extraction rather than showing a blank page', async () => {
    await seedDocument({ title: 'Scanned', text: '', extraction: 'empty', chars: 0 })
    mount()

    fireEvent.click(await screen.findByRole('button', { name: /Scanned/ }))

    expect(await screen.findByText(/Text extraction unavailable/)).toBeTruthy()
    // And says why, and that the file is untouched — the two questions a blank
    // page leaves someone asking.
    expect(screen.getByText(/does not run OCR/)).toBeTruthy()
    // Said twice on purpose — beside the warning, and where the text would
    // have been — so it is answered wherever the reader is looking.
    expect(screen.getAllByText(/still in your vault/).length).toBeGreaterThan(0)
  })

  it('says how much of a very long document was indexed', async () => {
    await seedDocument({ text: 'a'.repeat(50), extraction: 'truncated', chars: 50 })
    mount()

    fireEvent.click(await screen.findByRole('button', { name: /Design Basics/ }))

    expect(await screen.findByText(/the first 50 characters were indexed/)).toBeTruthy()
  })
})

describe('search', () => {
  it('finds text inside a PDF and opens the document it came from', async () => {
    await seedDocument({ text: 'Partitioning is the first idea.' })

    mount()
    await screen.findByRole('button', { name: /Design Basics/ })

    fireEvent.change(screen.getByPlaceholderText('Search notes and documents…'), {
      target: { value: 'partitioning' },
    })

    const results = await screen.findByLabelText('Search results')
    const hit = within(results).getByRole('button', { name: 'Design Basics' })
    fireEvent.click(hit)

    // The hit is a way in, not a dead end.
    expect(await screen.findByRole('article')).toBeTruthy()
    expect(screen.getByText('Partitioning is the first idea.')).toBeTruthy()
  })

  it('keeps notes and documents apart in the results', async () => {
    await createNote({ title: 'Partitioning notes', body: 'about partitioning' })
    await seedDocument({ text: 'Partitioning is the first idea.' })

    mount()
    fireEvent.change(await screen.findByPlaceholderText('Search notes and documents…'), {
      target: { value: 'partitioning' },
    })

    const results = await screen.findByLabelText('Search results')
    expect(within(results).getByText('Markdown Note')).toBeTruthy()
    expect(within(results).getByText('PDF')).toBeTruthy()
  })

  it('says so when nothing matched, and why a PDF might not', async () => {
    await seedDocument()
    mount()
    fireEvent.change(await screen.findByPlaceholderText('Search notes and documents…'), {
      target: { value: 'nothinglikethis' },
    })

    expect(await screen.findByText('Nothing matched')).toBeTruthy()
    expect(screen.getByText(/no text layer has nothing to match/)).toBeTruthy()
  })
})
