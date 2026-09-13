import { FileText, NotebookPen, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import type { DocumentSummary, KnowledgeHit } from '@/services'
import { useDocuments } from '../hooks/useDocuments'

/**
 * PDF documents read out of the vault, and search across them.
 *
 * Deliberately its own screen rather than a filter on Notes. A note is authored
 * content Vaultwork owns and writes back; a document is a file it may only
 * read. Putting them in one list would mean one set of actions for two things
 * that can be done to very different degrees.
 *
 * Search is local and deterministic — no provider, no network — so it answers
 * with the assistant switched off, and answers the same way twice.
 */

const KIND_LABEL: Record<KnowledgeHit['sourceType'], string> = {
  note: 'Markdown Note',
  pdf: 'PDF',
}

/** How the extraction went, in words rather than a silent empty body. */
function extractionNote(document: DocumentSummary): string | null {
  if (document.extraction === 'empty') {
    // No OCR here, and saying so is better than an empty page that looks broken.
    return 'Text extraction unavailable — this PDF has no text layer.'
  }
  if (document.extraction === 'truncated') {
    return `Very long document — the first ${document.chars.toLocaleString()} characters were indexed.`
  }
  return null
}

const readableSize = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

function HitRow({ hit }: { hit: KnowledgeHit }) {
  const isNote = hit.sourceType === 'note'
  return (
    <li className="flex flex-col gap-1 px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {isNote ? (
          <Link
            to={`/notes/${hit.id}`}
            className="text-[13px] font-medium text-ink hover:text-accent"
          >
            {hit.title}
          </Link>
        ) : (
          <span className="text-[13px] font-medium text-ink">{hit.title}</span>
        )}
        {/* The kind is a word and an icon, never colour alone. */}
        <Badge
          tone={isNote ? 'neutral' : 'confirm'}
          icon={isNote ? <NotebookPen size={10} /> : <FileText size={10} />}
        >
          {KIND_LABEL[hit.sourceType]}
        </Badge>
      </div>
      {hit.path ? (
        <p className="truncate font-mono text-[11px] text-ink-3" title={hit.path}>
          {hit.path}
        </p>
      ) : null}
      <p className="text-[12.5px] leading-relaxed text-ink-2">{hit.snippet}</p>
    </li>
  )
}

export function DocumentsView() {
  const { documents, results, query, setQuery } = useDocuments()

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="t-page flex items-center gap-2">
          <FileText size={16} className="text-ink-3" aria-hidden />
          Documents
        </h2>
        <p className="t-meta max-w-prose text-ink-3">
          PDFs read from your Obsidian vault. Vaultwork indexes their text so you can search it —
          the files themselves are never changed.
        </p>
      </header>

      <label className="flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 py-2 transition-colors focus-within:border-accent hover:border-accent-line">
        <Search size={13} className="shrink-0 text-ink-3" aria-hidden />
        <span className="sr-only">Search notes and documents</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes and documents…"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3"
        />
      </label>

      {results !== null && results !== undefined ? (
        <section className="flex flex-col gap-2" aria-label="Search results">
          <h3 className="t-eyebrow text-ink-3">
            {results.length} result{results.length === 1 ? '' : 's'}
          </h3>
          {results.length === 0 ? (
            <EmptyState
              title="Nothing matched"
              description="Search looks at note text and the text extracted from your PDFs. A PDF with no text layer has nothing to match."
            />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {results.map((hit) => (
                <HitRow key={`${hit.sourceType}:${hit.id}`} hit={hit} />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-2" aria-label="Documents">
          <DataView
            data={documents}
            isEmpty={(rows) => rows.length === 0}
            empty={
              <EmptyState
                icon={<FileText size={20} aria-hidden />}
                title="No documents yet"
                description="PDFs in your vault appear here once you import them."
                action={
                  <Link
                    to="/obsidian/sync"
                    className="text-[12.5px] text-accent underline decoration-dotted"
                  >
                    Open Sync center
                  </Link>
                }
              />
            }
          >
            {(rows) => (
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {rows.map((document) => {
                  const note = extractionNote(document)
                  return (
                    <li key={document.id} className="flex flex-col gap-1 px-3.5 py-2.5">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="inline-flex items-center gap-2 text-[13.5px] font-medium text-ink">
                          <span
                            className="grid h-5 w-5 shrink-0 place-items-center rounded bg-accent-2-soft text-accent-2"
                            aria-hidden
                          >
                            <FileText size={11} />
                          </span>
                          {document.title}
                        </span>
                        <span className="font-mono text-[11px] text-ink-3">
                          {readableSize(document.bytes)}
                        </span>
                      </div>
                      <p
                        className="truncate font-mono text-[11px] text-ink-3"
                        title={document.vaultPath}
                      >
                        {document.vaultPath}
                      </p>
                      {note ? (
                        <p className="text-[11.5px] text-warn">{note}</p>
                      ) : (
                        <p className="text-[11.5px] text-ink-3">
                          {document.chars.toLocaleString()} characters indexed
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </DataView>
        </section>
      )}
    </div>
  )
}
