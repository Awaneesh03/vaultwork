import { useEffect, useRef } from 'react'
import { ArrowDownUp, Search, X } from 'lucide-react'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import type {
  ProjectProgressFilter,
  ProjectSort,
  ProjectStateFilter,
} from '@/services'
import type { ProjectStatus } from '@/types/enums'
import type { ProjectToolbarFilter } from '@/store/projectUiStore'
import { EDITABLE_PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '../projectAppearance'

/**
 * Search, state and sort for the Projects screen.
 *
 * Active/Archived/All is a segmented control rather than a dropdown because it
 * is the one filter that is always on — something is always being hidden, and
 * a control that shows which is better than one you have to open to find out.
 *
 * The rest is a short row of selects. There is no collapsible filter panel
 * here: a project list is short, and four controls above it do not need a
 * disclosure.
 */

const STATES: { id: ProjectStateFilter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
]

const PROGRESS: { id: ProjectProgressFilter; label: string }[] = [
  { id: 'any', label: 'Any progress' },
  { id: 'overdue', label: 'Has overdue' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'complete', label: 'All done' },
  { id: 'empty', label: 'No tasks' },
]

const SORTS: { id: ProjectSort; label: string }[] = [
  { id: 'manual', label: 'Manual order' },
  { id: 'name', label: 'Name' },
  { id: 'progress', label: 'Progress' },
  { id: 'remaining', label: 'Remaining' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'updated', label: 'Updated' },
]

const SELECT =
  'h-7 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink-2 hover:border-line-strong focus:border-accent-line'

export interface ProjectToolbarProps {
  filter: ProjectToolbarFilter
  sort: ProjectSort
  activeCount: number
  archivedCount: number
  /** Bumped by the `/` shortcut to move focus into the search field. */
  focusNonce: number
  onSearch: (value: string) => void
  onState: (state: ProjectStateFilter) => void
  onProgress: (progress: ProjectProgressFilter) => void
  onStatus: (status: ProjectStatus | 'any') => void
  onSort: (sort: ProjectSort) => void
}

export function ProjectToolbar({
  filter,
  sort,
  activeCount,
  archivedCount,
  focusNonce,
  onSearch,
  onState,
  onProgress,
  onStatus,
  onSort,
}: ProjectToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusNonce > 0) searchRef.current?.focus()
  }, [focusNonce])

  const countFor = (state: ProjectStateFilter) =>
    state === 'active'
      ? activeCount
      : state === 'archived'
        ? archivedCount
        : activeCount + archivedCount

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-accent-line">
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
            placeholder="Search projects by name or description…"
            aria-label="Search projects"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink placeholder:text-ink-3"
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

        <label className="hidden items-center gap-1.5 sm:flex">
          <ArrowDownUp size={13} className="text-ink-3" aria-hidden />
          <span className="sr-only">Sort projects by</span>
          <select
            value={sort}
            onChange={(event) => onSort(event.target.value as ProjectSort)}
            className={SELECT}
          >
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Show projects"
          className="inline-flex rounded-md border border-line bg-surface p-0.5"
        >
          {STATES.map((state) => (
            <button
              key={state.id}
              type="button"
              onClick={() => onState(state.id)}
              aria-pressed={filter.state === state.id}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded px-2 text-[12px]',
                'transition-colors duration-[var(--duration-fast)]',
                filter.state === state.id
                  ? 'bg-accent-soft font-medium text-ink'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              {state.label}
              <span className="tabular text-[10.5px] text-ink-3">{countFor(state.id)}</span>
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Filter by progress</span>
          <select
            value={filter.progress}
            onChange={(event) => onProgress(event.target.value as ProjectProgressFilter)}
            className={SELECT}
          >
            {PROGRESS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Filter by status</span>
          <select
            value={filter.status}
            onChange={(event) => onStatus(event.target.value as ProjectStatus | 'any')}
            className={SELECT}
          >
            <option value="any">Any status</option>
            {EDITABLE_PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PROJECT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <span className="flex-1" />

        <span className="tabular hidden text-[11.5px] text-ink-3 sm:inline">
          {sort === 'manual' ? 'Drag to reorder' : 'Sorted — drag disabled'}
        </span>
      </div>
    </div>
  )
}
