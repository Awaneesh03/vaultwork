import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { GoalHealthFilter, GoalSort, GoalStateFilter } from '@/services'
import { GOAL_SORT_OPTIONS } from '../goalAppearance'
import type { GoalUiFilter } from '@/store/goalUiStore'

/**
 * Filtering and sorting for the Goals list.
 *
 * Segmented controls rather than a menu: with four states and three health
 * values, every option fits on screen, and a visible control tells you what is
 * currently applied without being opened. Each state carries its count, so
 * "Archived 3" answers "is anything hidden?" before you click it.
 */

const STATES: { id: GoalStateFilter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Complete' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
]

const HEALTHS: { id: GoalHealthFilter; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'on-track', label: 'On track' },
]

function Segment<T extends string>({
  label,
  options,
  value,
  counts,
  onChange,
}: {
  label: string
  options: { id: T; label: string }[]
  value: T
  counts?: Partial<Record<T, number>>
  onChange: (next: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5"
    >
      {options.map((option) => {
        const active = option.id === value
        const count = counts?.[option.id]
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={cn(
              'rounded-[5px] px-2 py-1 text-[11.5px] transition-colors duration-[var(--duration-fast)]',
              active ? 'bg-elevated text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {option.label}
            {typeof count === 'number' ? (
              <span className="tabular ml-1 text-ink-3">{count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function GoalToolbar({
  filter,
  sort,
  counts,
  focusNonce,
  onSearch,
  onState,
  onHealth,
  onSort,
}: {
  filter: GoalUiFilter
  sort: GoalSort
  counts: Record<GoalStateFilter, number>
  /** Bumped by the `/` shortcut, which focuses the field. */
  focusNonce: number
  onSearch: (value: string) => void
  onState: (value: GoalStateFilter) => void
  onHealth: (value: GoalHealthFilter) => void
  onSort: (value: GoalSort) => void
}) {
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusNonce > 0) search.current?.focus()
  }, [focusNonce])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[160px] flex-1">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          aria-hidden
        />
        <input
          ref={search}
          type="search"
          value={filter.search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search goals"
          aria-label="Search goals"
          className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-7 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-accent-line"
        />
        {filter.search.length > 0 ? (
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

      <Segment label="Goal state" options={STATES} value={filter.state} counts={counts} onChange={onState} />
      <Segment label="Deadline health" options={HEALTHS} value={filter.health} onChange={onHealth} />

      <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-3">
        <span className="sr-only sm:not-sr-only">Sort</span>
        <select
          value={sort}
          onChange={(event) => onSort(event.target.value as GoalSort)}
          aria-label="Sort goals"
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-[11.5px] text-ink-2 focus:border-accent-line"
        >
          {GOAL_SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
