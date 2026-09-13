import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Network } from 'lucide-react'
import { Skeleton } from '@/components/feedback/Skeleton'
import { SectionHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/cn'
import type { GraphFilter, GraphViewData } from '@/services'
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
 * The screen is built around the picture rather than around a list. The plot
 * takes the width it needs and the column beside it answers the question you
 * asked by clicking: what is this note, what does it reach, what reaches it.
 * With nothing selected that column describes the vault instead — how much of
 * it is connected, and how much is sitting on its own.
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

/** The plot, sized to the window rather than to a number picked once. */
const PLOT_HEIGHT = 'clamp(340px, 56vh, 640px)'

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

  const tagName = tags?.find((tag) => tag.id === tagId)?.name ?? null
  const focusTitle = graph?.nodes.find((node) => node.id === focusNoteId)?.title ?? null

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2.5">
        <Link
          to="/notes"
          className="inline-flex w-fit items-center gap-1 text-body text-ink-3 hover:text-accent"
        >
          <ArrowLeft size={12} aria-hidden />
          Notes
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"
            aria-hidden
          >
            <Network size={15} />
          </span>
          <h2 className="t-page text-ink">Graph</h2>
          {/*
            What is actually on screen, in words. "12 of 340, around Binary
            search, tagged dsa" is the state of this page; a bare node count
            leaves the user to reverse-engineer it from the controls.
          */}
          {graph ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-3">
              <span className="tabular rounded-sm bg-sunken px-1.5 py-0.5 text-ink-2">
                {graph.nodes.length}
                {graph.nodes.length !== graph.totalNodes ? ` of ${graph.totalNodes}` : ''} notes
              </span>
              <span className="tabular">{graph.edges.length} links</span>
              {focusTitle ? <span>· around “{focusTitle}”</span> : null}
              {tagName ? <span>· tagged {tagName}</span> : null}
            </p>
          ) : null}
        </div>
        <p className="t-meta max-w-prose text-ink-3">
          Every note, connected by the <code className="font-mono">[[wikilinks]]</code> in their
          bodies. Only links that resolve become lines — an unresolved or ambiguous link is a
          question, not a relationship.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Graph filter" className="flex flex-wrap items-center gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              title={option.hint}
              onClick={() => setParam('filter', option.id === 'all' ? null : option.id)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-meta',
                'transition-colors duration-[var(--duration-fast)]',
                filter === option.id
                  ? 'border-accent-line bg-accent-soft text-accent'
                  : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />

        <label className="flex shrink-0 items-center gap-1.5 text-meta text-ink-3">
          <span className="sr-only sm:not-sr-only">Tag</span>
          <select
            value={tagId ?? ''}
            onChange={(event) => setParam('tag', event.target.value || null)}
            aria-label="Filter the graph by tag"
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-meta text-ink-2 focus:border-accent"
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
            className="rounded-md border border-line px-2 py-1 text-meta text-ink-2 hover:border-accent-line hover:text-ink"
          >
            Show the whole vault
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        {graph === undefined ? (
          <Skeleton className="h-[420px] w-full" />
        ) : (
          <KnowledgeGraphView
            nodes={graph.nodes}
            edges={graph.edges}
            focusNoteId={focusNoteId}
            selectedNoteId={selected}
            height={PLOT_HEIGHT}
            onSelect={setSelected}
            onOpen={(noteId) => navigate(`/notes/${noteId}`)}
          />
        )}

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Graph details">
          {graph === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : selected === null ? (
            <VaultSummary graph={graph} />
          ) : (
            <NodeInspector graph={graph} noteId={selected} onSelect={setSelected} />
          )}
        </aside>
      </div>
    </section>
  )
}

/**
 * What the graph says about the vault, when no single note has been asked
 * about.
 *
 * Every figure here already exists on the query result. Nothing is recomputed
 * and nothing new is inferred — an orphan is what `getGraph` calls an orphan.
 */
function VaultSummary({ graph }: { graph: GraphViewData }) {
  const connected = graph.nodes.length - graph.orphanNoteIds.length

  // Most-linked first. Ties keep the order the query returned them in, which is
  // stable, so the list does not reshuffle on every live-query tick.
  const busiest = [...graph.nodes]
    .map((node) => ({ node, degree: node.incomingCount + node.outgoingCount }))
    .filter((row) => row.degree > 0)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5)

  return (
    <>
      <section className="flex flex-col gap-2.5">
        <SectionHeader label="This view" />
        <dl className="flex flex-col gap-1.5 text-body">
          <Row term="Connected" value={`${connected}`} />
          <Row
            term="Orphans"
            value={`${graph.orphanNoteIds.length}`}
            tone={graph.orphanNoteIds.length > 0 ? 'warn' : 'quiet'}
          />
          <Row
            term="Unresolved links"
            value={`${graph.unresolvedNoteIds.length}`}
            tone={graph.unresolvedNoteIds.length > 0 ? 'warn' : 'quiet'}
          />
        </dl>
      </section>

      {busiest.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionHeader label="Most connected" />
          <ul className="flex flex-col">
            {busiest.map(({ node, degree }) => (
              <li key={node.id}>
                <Link
                  to={`/notes/${node.id}`}
                  className="flex items-baseline justify-between gap-2 rounded-md px-1.5 py-1 text-body text-ink-2 hover:bg-surface hover:text-accent"
                >
                  <span className="min-w-0 truncate">{node.title}</span>
                  <span className="tabular shrink-0 text-micro text-ink-3">{degree}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-meta leading-relaxed text-ink-3">
          Nothing here links to anything yet. Write{' '}
          <code className="font-mono">[[a note title]]</code> inside a note and the line appears in
          both directions.
        </p>
      )}

      <p className="text-micro leading-relaxed text-ink-3">
        Click a node to see what it reaches. Double-click to open it.
      </p>
    </>
  )
}

/**
 * One note's neighbourhood, read off the drawn edges.
 *
 * Deliberately derived from `graph.edges` rather than from a second query: the
 * panel is explaining the picture beside it, and a separate lookup could
 * legitimately answer differently once a filter is on.
 */
function NodeInspector({
  graph,
  noteId,
  onSelect,
}: {
  graph: GraphViewData
  noteId: string
  onSelect: (noteId: string) => void
}) {
  const node = graph.nodes.find((candidate) => candidate.id === noteId)
  const titleOf = (id: string) =>
    graph.nodes.find((candidate) => candidate.id === id)?.title ?? 'note'

  const outgoing = graph.edges
    .filter((edge) => edge.source === noteId && edge.target !== noteId)
    .map((edge) => edge.target)
  const incoming = graph.edges
    .filter((edge) => edge.target === noteId && edge.source !== noteId)
    .map((edge) => edge.source)
  const selfLink = graph.edges.some((edge) => edge.source === noteId && edge.target === noteId)

  if (!node) {
    return (
      <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-meta text-ink-3">
        That note is no longer in this view.
      </p>
    )
  }

  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionHeader label="Selected" />
        <Link
          to={`/notes/${noteId}`}
          className="text-strong font-semibold leading-snug text-ink hover:text-accent"
        >
          {node.title}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-micro text-ink-3">
          <span className="tabular">{node.incomingCount} in</span>
          <span className="tabular">{node.outgoingCount} out</span>
          {selfLink ? <span>links to itself</span> : null}
          {node.tags.length > 0 ? <span className="truncate">{node.tags.join(', ')}</span> : null}
        </p>
      </section>

      <Neighbours
        label="Links to"
        ids={outgoing}
        titleOf={titleOf}
        onSelect={onSelect}
        empty="This note links nowhere."
      />
      <Neighbours
        label="Linked from"
        ids={incoming}
        titleOf={titleOf}
        onSelect={onSelect}
        empty="Nothing links here."
      />
    </>
  )
}

function Neighbours({
  label,
  ids,
  titleOf,
  onSelect,
  empty,
}: {
  label: string
  ids: string[]
  titleOf: (id: string) => string
  onSelect: (noteId: string) => void
  empty: string
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        label={label}
        actions={<span className="tabular text-micro text-ink-3">{ids.length}</span>}
      />
      {ids.length === 0 ? (
        <p className="px-1.5 text-meta text-ink-3">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {ids.map((id) => (
            <li key={id}>
              {/*
                Selecting rather than navigating. Walking outward one hop at a
                time is the whole point of a graph; opening the note would end
                the exploration you started.
              */}
              <button
                type="button"
                onClick={() => onSelect(id)}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-body text-ink-2 hover:bg-surface hover:text-ink"
              >
                <ArrowRight size={10} className="shrink-0 text-ink-3" aria-hidden />
                <span className="min-w-0 truncate">{titleOf(id)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({
  term,
  value,
  tone = 'quiet',
}: {
  term: string
  value: string
  tone?: 'quiet' | 'warn'
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-3">{term}</dt>
      <dd className={cn('tabular', tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</dd>
    </div>
  )
}
