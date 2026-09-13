import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Network } from 'lucide-react'
import { Skeleton } from '@/components/feedback/Skeleton'
import { cn } from '@/lib/cn'
import type { GraphFilter } from '@/services'
import { KnowledgeGraphView } from '../components/KnowledgeGraph'
import { useKnowledgeGraph } from '../hooks/useKnowledge'
import { useNoteTags } from '../hooks/useNotes'

/**
 * The whole vault as a graph.
 *
 * Read-only: opening this screen, filtering it and clicking around it write
 * nothing and emit no events. Everything drawn is derived from note bodies on
 * read, so the picture cannot disagree with the notes.
 *
 * The filters operate on the derived graph rather than re-querying, both
 * because the index is already in hand and because two paths to the same answer
 * are two chances to disagree.
 */

const FILTERS: { id: GraphFilter; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every note.' },
  { id: 'tagged', label: 'Tagged', hint: 'Notes carrying at least one tag.' },
  { id: 'orphans', label: 'Orphans', hint: 'Notes with no links in either direction.' },
  { id: 'unresolved', label: 'Unresolved', hint: 'Notes whose links point nowhere.' },
]

export function NoteGraphView() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)

  const filter = (searchParams.get('filter') as GraphFilter | null) ?? 'all'
  const tagId = searchParams.get('tag')
  const focusNoteId = searchParams.get('note')

  const options = useMemo(
    () => ({ filter, tagId, focusNoteId, depth: focusNoteId === null ? 1 : 2 }),
    [filter, tagId, focusNoteId],
  )
  const graph = useKnowledgeGraph(options)
  const tags = useNoteTags()

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <Link
          to="/notes"
          className="inline-flex w-fit items-center gap-1 text-[12px] text-ink-3 hover:text-accent"
        >
          <ArrowLeft size={12} aria-hidden />
          Notes
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <Network size={18} className="text-accent" aria-hidden />
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">Graph</h2>
          {graph ? (
            <span className="tabular rounded-sm bg-sunken px-1.5 py-0.5 text-[11.5px] text-ink-2">
              {graph.nodes.length}
              {graph.nodes.length !== graph.totalNodes ? ` of ${graph.totalNodes}` : ''}
            </span>
          ) : null}
        </div>
        <p className="max-w-prose text-[13px] text-ink-2">
          Every note, connected by the <code className="font-mono">[[wikilinks]]</code> in their
          bodies. Only links that resolve become lines — an unresolved or ambiguous link is a
          question, not a relationship.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Graph filter"
          className="flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5"
        >
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              title={option.hint}
              onClick={() => setParam('filter', option.id === 'all' ? null : option.id)}
              className={cn(
                'rounded-[5px] px-2 py-1 text-[11.5px] transition-colors duration-[var(--duration-fast)]',
                filter === option.id ? 'bg-elevated text-ink' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-3">
          <span className="sr-only sm:not-sr-only">Tag</span>
          <select
            value={tagId ?? ''}
            onChange={(event) => setParam('tag', event.target.value || null)}
            aria-label="Filter the graph by tag"
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-[11.5px] text-ink-2 focus:border-accent-line"
          >
            <option value="">Every tag</option>
            {(tags ?? []).map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>

        {focusNoteId !== null ? (
          <button
            type="button"
            onClick={() => setParam('note', null)}
            className="rounded-md border border-line px-2 py-1 text-[11.5px] text-ink-2 hover:border-accent-line hover:text-ink"
          >
            Show the whole vault
          </button>
        ) : null}
      </div>

      {graph === undefined ? (
        <Skeleton className="h-[520px] w-full" />
      ) : (
        <KnowledgeGraphView
          nodes={graph.nodes}
          edges={graph.edges}
          focusNoteId={focusNoteId}
          selectedNoteId={selected}
          onSelect={setSelected}
          onOpen={(noteId) => navigate(`/notes/${noteId}`)}
        />
      )}

      {selected !== null ? (
        <p className="text-[12px] text-ink-3">
          Selected{' '}
          <Link to={`/notes/${selected}`} className="text-accent underline decoration-dotted">
            {graph?.nodes.find((node) => node.id === selected)?.title ?? 'note'}
          </Link>{' '}
          · double-click a node to open it.
        </p>
      ) : null}
    </section>
  )
}
