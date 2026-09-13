import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  listDocuments,
  searchKnowledge,
  type DocumentSummary,
  type KnowledgeHit,
} from '@/services'

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
