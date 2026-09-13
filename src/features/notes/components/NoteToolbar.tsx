import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { NoteFilterKind } from '@/services'

/**
 * Search and filters for the notes list.
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[180px] flex-1">
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
          className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-7 text-body text-ink placeholder:text-ink-3 focus:border-accent-line"
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

      <div
        role="group"
        aria-label="Note filter"
        className="flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5"
      >
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            title={option.hint}
            onClick={() => onFilter(option.id)}
            className={cn(
              'rounded-[5px] px-2 py-1 text-meta transition-colors duration-[var(--duration-fast)]',
              filter === option.id ? 'bg-elevated text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {option.label}
            <span className="tabular ml-1 text-ink-3">{counts[option.id]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
