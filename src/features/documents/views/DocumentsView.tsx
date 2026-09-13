import { useState } from 'react'
import { FileText, NotebookPen, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { cn } from '@/lib/cn'
import { formatEventTime } from '@/lib/date'
import { platform } from '@/platform'
import type { DocumentSummary, KnowledgeHit } from '@/services'
import type { Id, VaultDocument } from '@/types/entities'
import { useDocument, useDocuments } from '../hooks/useDocuments'

/**
 * PDF documents read out of the vault, and search across them.
 *
 * Deliberately its own screen rather than a filter on Notes. A note is authored
 * content Vaultwork owns and writes back; a document is a file it may only
 * read. Putting them in one list would mean one set of actions for two things
 * that can be done to very different degrees.
 *
 * The screen is a library: the shelf on the left, the document you opened on
 * the right. Before this, a PDF's extracted text existed, was searched, and was
 * never once shown — the list said how many characters had been indexed and
 * offered no way to read a single one of them.
 *
 * Nothing here extracts anything. The text was pulled out by the Rust side at
 * import time, behind `catch_unwind`, and stored; this screen only reads what
 * Dexie already holds. Opening a document cannot crash an extractor, because
 * opening a document does not run one.
 *
 * Search is local and deterministic — no provider, no network — so it answers
 * with the assistant switched off, and answers the same way twice.
 */

const KIND_LABEL: Record<KnowledgeHit['sourceType'], string> = {
  note: 'Markdown Note',
  pdf: 'PDF',
}

/** How the extraction went, in words rather than a silent empty body. */
function extractionNote(document: {
  extraction: DocumentSummary['extraction']
  chars: number
}): string | null {
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

export function DocumentsView() {
  const { documents, results, query, setQuery } = useDocuments()
  const [openId, setOpenId] = useState<Id | null>(null)
  const open = useDocument(openId)

  const searching = results !== null && results !== undefined

  return (
    <section className="flex flex-col gap-5">
      <PageHeader
        icon={<FileText size={15} aria-hidden />}
        title="Documents"
        description="PDFs read from your Obsidian vault. Vaultwork indexes their text so you can search and read it — the files themselves are never changed."
        meta={
          documents ? (
            <span className="tabular">
              {documents.length} document{documents.length === 1 ? '' : 's'}
            </span>
          ) : null
        }
      />

      <label className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 transition-colors focus-within:border-accent hover:border-accent-line">
        <Search size={13} className="shrink-0 text-ink-3" aria-hidden />
        <span className="sr-only">Search notes and documents</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes and documents…"
          className="min-w-0 flex-1 bg-transparent text-strong text-ink placeholder:text-ink-3"
        />
        {query.length > 0 ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="shrink-0 rounded p-0.5 text-ink-3 hover:text-ink"
          >
            <X size={13} />
          </button>
        ) : null}
      </label>

      {searching ? (
        <section className="flex flex-col gap-2.5" aria-label="Search results">
          <SectionHeader
            label={`${results.length} result${results.length === 1 ? '' : 's'}`}
            actions={
              <span className="text-micro text-ink-3">Notes and the text inside your PDFs</span>
            }
          />
          {results.length === 0 ? (
            <EmptyState
              title="Nothing matched"
              description="Search looks at note text and the text extracted from your PDFs. A PDF with no text layer has nothing to match."
            />
          ) : (
            <ul className="divide-y divide-line panel">
              {results.map((hit) => (
                <HitRow
                  key={`${hit.sourceType}:${hit.id}`}
                  hit={hit}
                  // A PDF hit used to be dead text. It now opens the document
                  // it came out of, which is the whole point of having read it.
                  onOpen={() => {
                    setOpenId(hit.id)
                    setQuery('')
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
          <aside
            aria-label="Documents"
            className={cn(
              'flex min-w-0 flex-col gap-2',
              'lg:sticky lg:top-0 lg:max-h-[calc(100dvh-10rem)] lg:self-start',
              openId !== null && 'hidden lg:flex',
            )}
          >
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-sidebar">
              <DataView
                data={documents}
                loading={
                  <div className="flex flex-col gap-1 p-1.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Skeleton key={i} className="h-[54px] w-full" />
                    ))}
                  </div>
                }
                isEmpty={(rows) => rows.length === 0}
                empty={
                  <EmptyState
                    icon={<FileText size={20} aria-hidden />}
                    title="No documents yet"
                    description="PDFs in your vault appear here once you import them. Vaultwork reads them; it never writes them."
                    action={
                      <Link
                        to="/obsidian/sync"
                        className="text-body text-accent underline decoration-dotted"
                      >
                        Open Sync center
                      </Link>
                    }
                  />
                }
              >
                {(rows) => (
                  <ul className="flex flex-col gap-px p-1.5">
                    {rows.map((row) => (
                      <li key={row.id}>
                        <DocumentRow
                          document={row}
                          selected={row.id === openId}
                          onOpen={() => setOpenId(row.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </DataView>
            </div>
          </aside>

          <div className={cn('min-w-0', openId === null && 'hidden lg:block')}>
            {openId === null ? (
              <NothingOpen />
            ) : (
              <DocumentReader document={open} onClose={() => setOpenId(null)} />
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * One document on the shelf.
 *
 * A button rather than a link: there is no route for a document, and inventing
 * one would mean a URL that outlives the import it points at. The selected row
 * is marked by an accent rail, a raised surface and `aria-current` — the same
 * three independent signals the notes rail uses, for the same reason.
 */
function DocumentRow({
  document,
  selected,
  onOpen,
}: {
  document: DocumentSummary
  selected: boolean
  onOpen: () => void
}) {
  const unreadable = document.extraction === 'empty'

  return (
    <button
      type="button"
      onClick={onOpen}
      {...(selected ? { 'aria-current': 'true' as const } : {})}
      className={cn(
        'relative flex w-full flex-col gap-0.5 rounded-md py-2 pl-3 pr-2 text-left',
        'transition-colors duration-[var(--duration-fast)]',
        selected ? 'bg-elevated' : 'hover:bg-surface',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1.5 left-0 w-[3px] rounded-full transition-colors',
          selected ? 'bg-accent' : 'bg-transparent',
        )}
      />

      <span
        className={cn(
          'min-w-0 truncate text-strong leading-snug',
          selected ? 'font-semibold text-ink' : 'font-medium text-ink-2',
        )}
        title={document.title}
      >
        {document.title}
      </span>

      <span className="min-w-0 truncate font-mono text-micro text-ink-3" title={document.vaultPath}>
        {document.vaultPath}
      </span>

      <span className="flex flex-wrap items-center gap-x-2 text-micro text-ink-3">
        <span className="tabular">{readableSize(document.bytes)}</span>
        {/*
          The one state worth carrying on the shelf. A document with no text
          layer looks identical to every other row until you open it, and then
          the emptiness reads as a failure of this screen.
        */}
        {unreadable ? <span className="text-warn">No text layer</span> : null}
      </span>
    </button>
  )
}

/** The reading pane with nothing in it. */
function NothingOpen() {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-xl border border-dashed border-line bg-surface/40 px-6">
      <div className="flex max-w-xs flex-col items-center gap-2 text-center">
        <span
          className="grid h-10 w-10 place-items-center rounded-lg bg-sunken text-ink-3"
          aria-hidden
        >
          <FileText size={18} />
        </span>
        <p className="t-section text-ink-2">Nothing open</p>
        <p className="t-meta text-ink-3">
          Choose a document to read the text Vaultwork extracted from it.
        </p>
      </div>
    </div>
  )
}

/**
 * One document, read.
 *
 * The text is shown exactly as it was extracted — line breaks and all, in a
 * measure narrow enough to read. It is deliberately not reflowed or cleaned up:
 * what is on screen is what was indexed, so a search result that looks odd can
 * be traced to the text it actually matched rather than to a prettier version
 * of it.
 */
function DocumentReader({
  document,
  onClose,
}: {
  document: VaultDocument | null | undefined
  onClose: () => void
}) {
  if (document === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    )
  }

  if (document === null) {
    return (
      <EmptyState
        icon={<FileText size={20} aria-hidden />}
        title="No such document"
        description="It may have been forgotten in the Sync center since this list was drawn."
        action={
          <button
            type="button"
            onClick={onClose}
            className="text-body text-accent underline decoration-dotted"
          >
            Back to documents
          </button>
        }
      />
    )
  }

  const note = extractionNote(document)
  const now = platform.clock.now()
  const today = platform.clock.today()

  return (
    <article className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onClose}
          className="w-fit text-body text-ink-3 hover:text-accent lg:hidden"
        >
          ← Documents
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="t-page min-w-0 text-ink">{document.title}</h2>
          {/* The kind is a word and an icon, never colour alone. */}
          <Badge tone="confirm" icon={<FileText size={10} />}>
            PDF
          </Badge>
        </div>

        {/*
          Metadata as one line under a rule. It is about the document, not in
          it, and every fact here given its own labelled box would push the
          first line of text below the fold.
        */}
        <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line pb-2.5 text-micro text-ink-3">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <dt className="sr-only">Path</dt>
            <dd className="min-w-0 truncate font-mono" title={document.vaultPath}>
              {document.vaultPath}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Size</dt>
            <dd className="tabular text-ink-2">{readableSize(document.bytes)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Indexed</dt>
            <dd className="tabular text-ink-2">{document.chars.toLocaleString()} characters</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Read</dt>
            <dd className="text-ink-2">{formatEventTime(document.importedAt, now, today)}</dd>
          </div>
        </dl>
      </header>

      {note ? (
        <p
          role="status"
          className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-body leading-relaxed text-warn"
        >
          {note}
          {document.extraction === 'empty' ? (
            <span className="mt-1 block text-meta">
              Vaultwork does not run OCR, so a scanned page has nothing to index. The file is
              untouched and still in your vault.
            </span>
          ) : null}
        </p>
      ) : null}

      {document.text.length > 0 ? (
        <div className="panel max-h-[calc(100dvh-18rem)] overflow-y-auto px-5 py-4">
          <p className="max-w-[68ch] whitespace-pre-wrap text-body leading-relaxed text-ink-2">
            {document.text}
          </p>
        </div>
      ) : (
        <div className="grid min-h-[200px] place-items-center rounded-xl border border-dashed border-line px-6">
          <p className="max-w-xs text-center text-meta text-ink-3">
            Nothing to read. The file is still in your vault and still searchable by name.
          </p>
        </div>
      )}
    </article>
  )
}

function HitRow({ hit, onOpen }: { hit: KnowledgeHit; onOpen: () => void }) {
  const isNote = hit.sourceType === 'note'
  return (
    <li className="flex flex-col gap-1 px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {isNote ? (
          <Link
            to={`/notes/${hit.id}`}
            className="text-strong font-medium text-ink hover:text-accent"
          >
            {hit.title}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="text-strong font-medium text-ink hover:text-accent"
          >
            {hit.title}
          </button>
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
        <p className="truncate font-mono text-micro text-ink-3" title={hit.path}>
          {hit.path}
        </p>
      ) : null}
      <p className="max-w-prose text-body leading-relaxed text-ink-2">{hit.snippet}</p>
    </li>
  )
}
