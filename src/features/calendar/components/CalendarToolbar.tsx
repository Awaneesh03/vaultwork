import { CalendarClock, ChevronLeft, ChevronRight, Plus, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import type { CalendarMode } from '@/lib/calendar'
import type { CalendarData, TaskStatusFilter } from '@/services'

/**
 * Period, navigation, view and filter.
 *
 * The filter reuses M3's `TaskStatusFilter` verbatim rather than introducing a
 * calendar filter engine: "all / to do / done" is the same question the task
 * views already answer, and answering it twice is how two screens end up
 * disagreeing about what a completed task is.
 */

const MODES: { id: CalendarMode; label: string; key: string }[] = [
  { id: 'month', label: 'Month', key: 'M' },
  { id: 'week', label: 'Week', key: 'W' },
  { id: 'day', label: 'Day', key: 'D' },
]

const FILTERS: { id: TaskStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To do' },
  { id: 'done', label: 'Done' },
]

export interface CalendarToolbarProps {
  data: CalendarData
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
  onMode: (mode: CalendarMode) => void
  onStatus: (status: TaskStatusFilter) => void
  onNewTask: () => void
  status: TaskStatusFilter
}

export function CalendarToolbar({
  data,
  status,
  onPrevious,
  onNext,
  onToday,
  onMode,
  onStatus,
  onNewTask,
}: CalendarToolbarProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock size={18} className="shrink-0 text-accent" aria-hidden />
        <h2 className="text-display font-semibold tracking-tight text-ink">Calendar</h2>

        <span className="flex-1" />

        <Button
          variant="primary"
          size="sm"
          onClick={onNewTask}
          icon={<Plus size={12} aria-hidden />}
        >
          New task
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-md border border-line bg-surface">
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Previous period"
            className="rounded-l-md px-1.5 py-1 text-ink-2 transition-colors hover:bg-elevated hover:text-ink"
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="border-x border-line px-2 py-1 text-body text-ink-2 transition-colors hover:bg-elevated hover:text-ink"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next period"
            className="rounded-r-md px-1.5 py-1 text-ink-2 transition-colors hover:bg-elevated hover:text-ink"
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>

        {/* `aria-live` so a keyboard user hears the period they moved to. */}
        <p
          aria-live="polite"
          className="min-w-0 truncate text-strong font-medium tracking-tight text-ink"
        >
          {data.title}
        </p>

        <span className="flex-1" />

        {data.counts.overdue > 0 ? (
          <span className="tabular inline-flex shrink-0 items-center gap-1 rounded-sm bg-danger-soft px-1.5 py-0.5 text-micro text-danger">
            <TriangleAlert size={10} aria-hidden />
            {data.counts.overdue} overdue
          </span>
        ) : null}

        <label className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">Show tasks</span>
          <select
            value={status}
            onChange={(event) => onStatus(event.target.value as TaskStatusFilter)}
            className="h-7 rounded-md border border-line bg-surface px-2 text-body text-ink-2 hover:border-line-strong focus:border-accent-line"
          >
            {FILTERS.map((filter) => (
              <option key={filter.id} value={filter.id}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>

        <div
          role="group"
          aria-label="Calendar view"
          className="inline-flex shrink-0 rounded-md border border-line bg-surface p-0.5"
        >
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => onMode(mode.id)}
              aria-pressed={data.mode === mode.id}
              title={`${mode.label} (shift ${mode.key})`}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded px-2 text-body',
                'transition-colors duration-[var(--duration-fast)]',
                data.mode === mode.id
                  ? 'bg-accent-soft font-medium text-ink'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              {mode.label}
              <Kbd className="hidden lg:inline-flex">{mode.key}</Kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
