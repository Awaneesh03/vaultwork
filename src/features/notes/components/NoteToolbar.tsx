import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { NoteFilterKind } from '@/services'

/**
 * Search and filters for the notes rail.
 *
 * Stacked rather than laid out in a row: this sits in a 300px column beside the
 * note being read, where a segmented control with five labelled counts would
 * either overflow or shrink its own labels to nothing. Chips wrap; a segment
 * cannot.
 *
 * Each filter carries its count, so "Deleted 3" answers "is anything hidden?"
 * before you click it — the same pattern the projects, habits and goals
 * toolbars use.
 */

const FILTERS: { id: NoteFilterKind; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every note.' },
  { id: 'linked', label: 'Linked', hint: 'Notes attached to a task, project, goal or habit.' },
  { id: 'unlinked', label: 'Unlinked', hint: 'Notes attached to nothing.' },
  {
    id: 'orphans',
    label: 'Orphans',
    // Deliberately distinct from "Unlinked": that is about entity attachments,
    // this is about wikilinks between notes.
    hint: 'Notes with no wikilinks in either direction. Tags do not count.',
  },
  { id: 'deleted', label: 'Deleted', hint: 'Notes in the trash.' },
]

export function NoteToolbar({
  filter,
  search,
  counts,
  focusNonce,
  onFilter,
  onSearch,
}: {
  filter: NoteFilterKind
  search: string
  counts: Record<NoteFilterKind, number>
  /** Bumped by the `/` shortcut, which focuses the field. */
  focusNonce: number
  onFilter: (filter: NoteFilterKind) => void
  onSearch: (search: string) => void
}) {
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusNonce > 0) box.current?.focus()
  }, [focusNonce])

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          aria-hidden
        />
        <input
          ref={box}
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search titles, text and tags"
          aria-label="Search notes"
          className={cn(
            'w-full rounded-md border border-line-strong bg-sunken py-1.5 pl-8 pr-7',
            'text-body text-ink placeholder:text-ink-3',
            'transition-colors duration-[var(--duration-fast)] focus:border-accent focus:bg-surface',
          )}
        />
        {search.length > 0 ? (
          <button
            type="button"
            onClick={() => onSearch('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:text-ink"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>

      {/*
        Chips rather than a segmented control. The count is the point — a filter
        that reads "Deleted 3" has already answered the question most people
        open it to ask — and five labelled counts do not fit on one line here.
      */}
      <div role="group" aria-label="Note filter" className="flex flex-wrap items-center gap-1">
        {FILTERS.map((option) => {
          const active = filter === option.id
          const empty = counts[option.id] === 0
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              title={option.hint}
              onClick={() => onFilter(option.id)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-meta',
                'transition-colors duration-[var(--duration-fast)]',
                active
                  ? 'border-accent-line bg-accent-soft text-accent'
                  : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2',
                // An empty filter recedes rather than disappearing: knowing the
                // trash is empty is worth the four pixels it costs.
                !active && empty && 'opacity-60',
              )}
            >
              {option.label}
              <span className={cn('tabular ml-1', active ? 'text-accent' : 'text-ink-3')}>
                {counts[option.id]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
