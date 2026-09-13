import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  getDocument,
  listDocuments,
  searchKnowledge,
  type DocumentSummary,
  type KnowledgeHit,
} from '@/services'
import type { Id, VaultDocument } from '@/types/entities'

/**
 * Imported PDF documents, and search across everything Vaultwork has read.
 *
 * Both queries are live, so importing a PDF in Sync Center makes it appear here
 * without a refresh. Search runs locally and deterministically — it does not
 * touch the AI provider, and works with the assistant switched off.
 */

export interface DocumentsController {
  /** `undefined` while the first query is in flight — `DataView`'s signal. */
  documents: DocumentSummary[] | undefined
  /** Null until something has been searched for. */
  results: KnowledgeHit[] | undefined | null
  query: string
  setQuery: (query: string) => void
}

export function useDocuments(): DocumentsController {
  const [query, setQuery] = useState('')
  const documents = useLiveQuery(() => listDocuments(), [])
  const trimmed = query.trim()

  // Notes and documents together: someone searching their knowledge does not
  // think in stores, and the result rows say which kind each one is.
  const results = useLiveQuery(
    () => (trimmed.length === 0 ? Promise.resolve(null) : searchKnowledge(trimmed)),
    [trimmed],
  )

  return { documents, results, query, setQuery }
}

/**
 * One document, text included, for the reading pane.
 *
 * Separate from `listDocuments` on purpose: the list query deliberately drops
 * the `text` column, because a hundred PDFs' worth of extracted characters is
 * not something a sidebar should be carrying around. The text is fetched only
 * for the one document actually being read.
 *
 * `null` when nothing is open or the document is gone; `undefined` while the
 * query is in flight, which is the loading signal the pane renders against.
 */
export function useDocument(id: Id | null): VaultDocument | null | undefined {
  return useLiveQuery(async () => (id === null ? null : await getDocument(id)), [id])
}
