import { vaultDocumentRepo } from '@/repositories'
import type { Id, Timestamp, VaultDocument } from '@/types/entities'
import { getNotesView, type NoteListItem } from './noteQueryService'

/**
 * Documents, and search across everything Vaultwork has read.
 *
 * Read-only, deterministic, and completely independent of the AI provider. A
 * search here is string matching over text already in Dexie — it works with the
 * assistant switched off, with no network, and gives the same answer twice.
 * That matters more than it sounds: a search that quietly needed a model would
 * be a search that stops working when a key expires.
 *
 * Notes and documents are ranked together but never merged. Every result says
 * which kind it is, because "DSA Recursion" being a note you can edit and
 * "System Design Basics" being a PDF you cannot are different affordances, and
 * a list that hid the difference would offer the wrong one.
 */

export type KnowledgeSourceType = 'note' | 'pdf'

export interface KnowledgeHit {
  id: Id
  sourceType: KnowledgeSourceType
  title: string
  /** Vault-relative path, when the item has one. */
  path: string | null
  /** The text around the first match, with the query in context. */
  snippet: string
  /** How many times the terms matched. Used for ordering, shown as a count. */
  matches: number
  updatedAt: Timestamp
  /** Documents only: why there is no text, when there is none. */
  extraction?: VaultDocument['extraction']
}

export interface DocumentSummary {
  id: Id
  title: string
  vaultPath: string
  kind: 'pdf'
  extraction: VaultDocument['extraction']
  chars: number
  bytes: number
  importedAt: Timestamp
  updatedAt: Timestamp
}

/** How much text surrounds a match in a snippet. */
const SNIPPET_RADIUS = 90
/** The most hits one search returns. A list nobody scrolls is not a result. */
const DEFAULT_LIMIT = 30

const terms = (query: string): string[] => query.trim().toLowerCase().split(/\s+/).filter(Boolean)

/**
 * A readable window around the first match.
 *
 * Extracted PDF text is ragged — page furniture, hard-wrapped lines — so
 * whitespace is collapsed before the window is cut. Without that a snippet is
 * often mostly newlines, which tells the reader nothing about why it matched.
 */
export function snippetAround(text: string, query: string, radius = SNIPPET_RADIUS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const words = terms(query)
  if (words.length === 0 || flat.length === 0) return flat.slice(0, radius * 2)

  const lowered = flat.toLowerCase()
  const at = words.map((word) => lowered.indexOf(word)).filter((index) => index >= 0)
  if (at.length === 0) return flat.slice(0, radius * 2)

  const first = Math.min(...at)
  const start = Math.max(0, first - radius)
  const end = Math.min(flat.length, first + radius)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

/** How many times every term appears. Zero when any term is absent. */
function scoreOf(haystack: string, query: string): number {
  const words = terms(query)
  if (words.length === 0) return 0

  const lowered = haystack.toLowerCase()
  let total = 0
  for (const word of words) {
    let count = 0
    let index = lowered.indexOf(word)
    while (index >= 0) {
      count += 1
      index = lowered.indexOf(word, index + word.length)
    }
    // Every term must appear, so a second word narrows rather than widens —
    // the same rule note search already follows.
    if (count === 0) return 0
    total += count
  }
  return total
}

/** Live PDF documents, without their text. */
export async function listDocuments(): Promise<DocumentSummary[]> {
  const rows = await vaultDocumentRepo.listSummaries()
  return rows
    .map((row) => ({
      id: row.id,
      title: row.title,
      vaultPath: row.vaultPath,
      kind: row.kind,
      extraction: row.extraction,
      chars: row.chars,
      bytes: row.bytes,
      importedAt: row.importedAt,
      updatedAt: row.updatedAt,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** One document, text included. For a reading view. */
export async function getDocument(id: Id): Promise<VaultDocument | null> {
  return (await vaultDocumentRepo.get(id)) ?? null
}

export interface KnowledgeSearchOptions {
  limit?: number
  /** Narrow to one kind. Omitted means both. */
  sourceType?: KnowledgeSourceType
}

/**
 * Searches notes and PDF documents together.
 *
 * Never calls the AI provider and never touches the filesystem: the text is
 * already in Dexie, put there by an explicit import. Knowledge search works
 * with the assistant disabled, which is the point.
 */
export async function searchKnowledge(
  query: string,
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeHit[]> {
  const limit = options.limit ?? DEFAULT_LIMIT
  if (terms(query).length === 0) return []

  const wantNotes = options.sourceType !== 'pdf'
  const wantDocuments = options.sourceType !== 'note'

  const [noteView, documents] = await Promise.all([
    wantNotes ? getNotesView({ search: query }) : null,
    wantDocuments ? vaultDocumentRepo.listSearchable() : [],
  ])

  const hits: KnowledgeHit[] = []

  for (const item of noteView?.notes ?? []) {
    hits.push(noteHit(item, query))
  }

  for (const document of documents) {
    const score = scoreOf(`${document.title}\n${document.text}`, query)
    if (score === 0) continue
    hits.push({
      id: document.id,
      sourceType: 'pdf',
      title: document.title,
      path: document.vaultPath,
      snippet: snippetAround(document.text, query),
      matches: score,
      updatedAt: document.updatedAt,
      extraction: document.extraction,
    })
  }

  return hits.sort((a, b) => b.matches - a.matches || b.updatedAt - a.updatedAt).slice(0, limit)
}

function noteHit(item: NoteListItem, query: string): KnowledgeHit {
  const body = item.note.body
  return {
    id: item.note.id,
    sourceType: 'note',
    title: item.title,
    path: item.note.vaultPath,
    snippet: snippetAround(`${item.title} ${body}`, query),
    matches: Math.max(1, scoreOf(`${item.title}\n${body}`, query)),
    updatedAt: item.note.updatedAt,
  }
}

// ------------------------------------------------------------- AI retrieval

/**
 * Words that carry no signal in a question.
 *
 * Deliberately a small, fixed, hand-written list rather than anything derived.
 * It exists so "summarize the system design pdf" retrieves on *system* and
 * *design* instead of failing because the document does not contain the word
 * "summarize".
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'about',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'document',
  'documents',
  'for',
  'from',
  'give',
  'have',
  'how',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'paper',
  'pdf',
  'pdfs',
  'please',
  'say',
  'says',
  'show',
  'summarise',
  'summarize',
  'summary',
  'tell',
  'that',
  'the',
  'their',
  'them',
  'these',
  'this',
  'to',
  'what',
  'when',
  'where',
  'which',
  'with',
  'you',
  'your',
])

/**
 * Documents relevant to a natural-language question.
 *
 * Deliberately *not* `searchKnowledge`. That one requires every term, which is
 * the right rule for a search box — a second word should narrow. It is the
 * wrong rule for a question, where "summarize the system design pdf" would
 * match nothing because no document contains the word "summarize".
 *
 * So this scores on the significant words instead, ranks by how many matched,
 * and returns nothing when none did. Still deterministic, still local, still
 * over text the user explicitly imported: the model neither chooses the
 * document nor sees one it was not given.
 */
export async function retrieveDocumentPassages(
  query: string,
  limit: number,
): Promise<KnowledgeHit[]> {
  const words = terms(query).filter((word) => word.length > 2 && !STOPWORDS.has(word))
  if (words.length === 0) return []

  const documents = await vaultDocumentRepo.listSearchable()
  const scored: KnowledgeHit[] = []

  for (const document of documents) {
    const haystack = `${document.title}\n${document.text}`.toLowerCase()
    // A title match counts for more: naming the document is a stronger signal
    // than a word appearing once somewhere in fifty pages.
    const title = document.title.toLowerCase()
    let score = 0
    let best = ''
    for (const word of words) {
      if (!haystack.includes(word)) continue
      score += title.includes(word) ? 5 : 1
      if (best === '') best = word
    }
    if (score === 0) continue

    scored.push({
      id: document.id,
      sourceType: 'pdf',
      title: document.title,
      path: document.vaultPath,
      snippet: snippetAround(document.text, best, 600),
      matches: score,
      updatedAt: document.updatedAt,
      extraction: document.extraction,
    })
  }

  return scored.sort((a, b) => b.matches - a.matches || b.updatedAt - a.updatedAt).slice(0, limit)
}
