import { useEffect, useRef, useState } from 'react'
import { ArrowDownUp, Search, SlidersHorizontal, X } from 'lucide-react'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import type { DueFilter, EstimateFilter, SortDirection, TaskSort, TaskViewId } from '@/services'
import type { Id, Project, Tag } from '@/types/entities'
import { PRIORITIES, type Priority } from '@/types/enums'
import type { ToolbarFilter } from '@/store/taskUiStore'
import { PRIORITY_LABELS } from '../priority'

/**
 * Search, sort and filters.
 *
 * Filters live behind a toggle with a count on it. A row of fifteen always-open
 * controls above a list of six tasks is a settings screen wearing a toolbar's
 * clothes; the count is enough to tell you something is on.
 */

const SORT_OPTIONS: { id: TaskSort; label: string }[] = [
  { id: 'manual', label: 'Manual order' },
  { id: 'dueDate', label: 'Due date' },
  { id: 'priority', label: 'Priority' },
  { id: 'created', label: 'Created' },
  { id: 'updated', label: 'Updated' },
  { id: 'completed', label: 'Completed' },
]

const DUE_OPTIONS: { id: DueFilter; label: string }[] = [
  { id: 'any', label: 'Any date' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'unscheduled', label: 'Unscheduled' },
]

const ESTIMATE_OPTIONS: { id: EstimateFilter; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'yes', label: 'Estimated' },
  { id: 'no', label: 'No estimate' },
]

export interface TaskToolbarProps {
  view: TaskViewId
  filter: ToolbarFilter
  sort: TaskSort
  direction: SortDirection
  tags: Tag[]
  projects: Project[]
  activeCount: number
  /**
   * Hides the project select. Set by the project detail screen, where the
   * project *is* the view and a second project control would contradict it.
   */
  hideProject?: boolean
  /** Bumped by the `/` shortcut to move focus into the search field. */
  focusNonce: number
  onSearch: (value: string) => void
  onTogglePriority: (priority: Priority) => void
  onDue: (due: DueFilter) => void
  onProject: (projectId: Id | null | 'any') => void
  onToggleTag: (tagId: Id) => void
  onTagMode: (mode: 'any' | 'all') => void
  onEstimate: (value: EstimateFilter) => void
  onSort: (sort: TaskSort, direction: SortDirection) => void
  onClear: () => void
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-2 py-0.5 text-[12px] transition-colors duration-[var(--duration-fast)]',
        active
          ? 'border-accent bg-accent-soft text-ink'
          : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

const SELECT =
  'h-7 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink-2 focus:border-line-strong'

export function TaskToolbar({
  view,
  filter,
  sort,
  direction,
  tags,
  projects,
  activeCount,
  hideProject = false,
  focusNonce,
  onSearch,
  onTogglePriority,
  onDue,
  onProject,
  onToggleTag,
  onTagMode,
  onEstimate,
  onSort,
  onClear,
}: TaskToolbarProps) {
  const [open, setOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusNonce > 0) searchRef.current?.focus()
  }, [focusNonce])

  // Today and Upcoming own their grouping; a due-date filter on top of them
  // would be two answers to the same question.
  const showDue = view !== 'today' && view !== 'upcoming' && view !== 'overdue'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-line-strong">
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
            placeholder="Search title, notes, tags, project…"
            aria-label="Search tasks"
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
          <span className="sr-only">Sort by</span>
          <select
            value={sort}
            onChange={(event) => onSort(event.target.value as TaskSort, direction)}
            className={SELECT}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {sort !== 'manual' ? (
          <button
            type="button"
            onClick={() => onSort(sort, direction === 'asc' ? 'desc' : 'asc')}
            className="hidden h-7 shrink-0 rounded-md border border-line px-2 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink sm:block"
            aria-label={direction === 'asc' ? 'Sort ascending' : 'Sort descending'}
          >
            {direction === 'asc' ? '↑' : '↓'}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px]',
            'transition-colors duration-[var(--duration-fast)]',
            activeCount > 0
              ? 'border-accent bg-accent-soft text-ink'
              : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
          )}
        >
          <SlidersHorizontal size={13} aria-hidden />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 ? <span className="tabular">{activeCount}</span> : null}
        </button>
      </div>

      {open ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 t-eyebrow text-ink-3">
              Priority
            </span>
            {PRIORITIES.filter((priority) => priority !== 'none').map((priority) => (
              <Pill
                key={priority}
                active={filter.priorities.includes(priority)}
                onClick={() => onTogglePriority(priority)}
              >
                {PRIORITY_LABELS[priority]}
              </Pill>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showDue ? (
              <label className="flex items-center gap-1.5">
                <span className="t-eyebrow text-ink-3">
                  Due
                </span>
                <select
                  value={filter.due}
                  onChange={(event) => onDue(event.target.value as DueFilter)}
                  className={SELECT}
                >
                  {DUE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {view !== 'inbox' && !hideProject ? (
              <label className="flex items-center gap-1.5">
                <span className="t-eyebrow text-ink-3">
                  Project
                </span>
                <select
                  value={filter.projectId === 'any' ? 'any' : (filter.projectId ?? 'none')}
                  onChange={(event) => {
                    const value = event.target.value
                    onProject(value === 'any' ? 'any' : value === 'none' ? null : value)
                  }}
                  className={SELECT}
                >
                  <option value="any">Any project</option>
                  <option value="none">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="flex items-center gap-1.5">
              <span className="t-eyebrow text-ink-3">
                Estimate
              </span>
              <select
                value={filter.hasEstimate}
                onChange={(event) => onEstimate(event.target.value as EstimateFilter)}
                className={SELECT}
              >
                {ESTIMATE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 t-eyebrow text-ink-3">
                Tags
              </span>
              {tags.map((tag) => (
                <Pill
                  key={tag.id}
                  active={filter.tagIds.includes(tag.id)}
                  onClick={() => onToggleTag(tag.id)}
                >
                  #{tag.name}
                </Pill>
              ))}
              {filter.tagIds.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onTagMode(filter.tagMode === 'any' ? 'all' : 'any')}
                  className="ml-1 rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-3 hover:text-ink"
                >
                  match {filter.tagMode}
                </button>
              ) : null}
            </div>
          ) : null}

          {activeCount > 0 ? (
            <div className="flex justify-end border-t border-line pt-2">
              <button
                type="button"
                onClick={onClear}
                className="text-[12px] text-ink-3 underline decoration-dotted hover:text-ink"
              >
                Clear all filters
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
