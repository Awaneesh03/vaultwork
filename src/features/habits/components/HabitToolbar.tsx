import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import type { HabitFrequency } from '@/services'
import type { HabitFilter, HabitStateFilter, HabitTodayFilter } from '@/store/habitUiStore'
import { HABIT_FREQUENCY_LABELS } from '../habitAppearance'

/**
 * Search, state and the two filters worth having.
 *
 * Deliberately short: a habit list is a handful of rows, and M7 is a tracker
 * rather than an analytics tool. Active/Archived/All is a segmented control for
 * the same reason it is on the projects screen — something is always hidden,
 * and a control that shows which beats one you have to open to find out.
 */

const STATES: { id: HabitStateFilter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
]

const TODAY: { id: HabitTodayFilter; label: string }[] = [
  { id: 'any', label: 'Any status' },
  { id: 'todo', label: 'Still to do' },
  { id: 'done', label: 'Done today' },
]

const FREQUENCIES: (HabitFrequency | 'any')[] = ['any', 'daily', 'weekdays', 'custom', 'weekly']

const SELECT =
  'h-7 rounded-md border border-line bg-surface px-2 text-body text-ink-2 hover:border-line-strong focus:border-accent-line'

export function HabitToolbar({
  filter,
  activeCount,
  archivedCount,
  focusNonce,
  onSearch,
  onState,
  onToday,
  onFrequency,
}: {
  filter: HabitFilter
  activeCount: number
  archivedCount: number
  focusNonce: number
  onSearch: (value: string) => void
  onState: (state: HabitStateFilter) => void
  onToday: (today: HabitTodayFilter) => void
  onFrequency: (frequency: HabitFrequency | 'any') => void
}) {
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusNonce > 0) searchRef.current?.focus()
  }, [focusNonce])

  const countFor = (state: HabitStateFilter) =>
    state === 'active'
      ? activeCount
      : state === 'archived'
        ? archivedCount
        : activeCount + archivedCount

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-accent-line">
        <Search size={13} className="shrink-0 text-ink-3" aria-hidden />
        <input
          ref={searchRef}
          value={filter.search}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              if (filter.search.length > 0) onSearch('')
              else searchRef.current?.blur()
            }
          }}
          placeholder="Search habits by name…"
          aria-label="Search habits"
          className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-3"
        />
        {filter.search.length > 0 ? (
          <button
            type="button"
            onClick={() => onSearch('')}
            aria-label="Clear search"
            className="shrink-0 rounded p-0.5 text-ink-3 hover:text-ink"
          >
            <X size={12} />
          </button>
        ) : (
          <Kbd className="hidden shrink-0 sm:inline-flex">/</Kbd>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Show habits"
          className="inline-flex rounded-md border border-line bg-surface p-0.5"
        >
          {STATES.map((state) => (
            <button
              key={state.id}
              type="button"
              onClick={() => onState(state.id)}
              aria-pressed={filter.state === state.id}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded px-2 text-body transition-colors',
                filter.state === state.id
                  ? 'bg-accent-soft font-medium text-ink'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              {state.label}
              <span className="tabular text-micro text-ink-3">{countFor(state.id)}</span>
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Filter by today&rsquo;s status</span>
          <select
            value={filter.today}
            onChange={(event) => onToday(event.target.value as HabitTodayFilter)}
            className={SELECT}
          >
            {TODAY.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Filter by frequency</span>
          <select
            value={filter.frequency}
            onChange={(event) => onFrequency(event.target.value as HabitFrequency | 'any')}
            className={SELECT}
          >
            {FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {frequency === 'any' ? 'Any frequency' : HABIT_FREQUENCY_LABELS[frequency]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
