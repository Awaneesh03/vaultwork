import type { ReactNode } from 'react'
import { Archive, ArchiveRestore, Check, Flame, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { projectColorVar } from '@/features/projects/projectAppearance'
import type { HabitListItem } from '@/services'
import { HABIT_FREQUENCY_LABELS, describeDays } from '../habitAppearance'
import { HabitHistoryStrip } from './HabitHistoryStrip'

/**
 * One habit.
 *
 * Purely presentational: view model and callbacks in, no state, no hook — the
 * same contract `TaskRow` and `ProjectRow` keep, for the same reasons.
 *
 * The information order is the question actually being asked: *is it done
 * today → what is it → how often → how is it going.* Today's control is a real
 * `checkbox` with `aria-checked`, so completion is never communicated by colour
 * alone, and a habit that is not due today says so in words rather than simply
 * looking different.
 */

export interface HabitRowProps {
  item: HabitListItem
  selected?: boolean
  dragging?: boolean
  onToggle: () => void
  onOpen: () => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
  onSelect?: () => void
  /** The drag grip, supplied by the sortable wrapper. */
  handle?: ReactNode
}

function scheduleText(item: HabitListItem): string {
  if (item.frequency === 'weekly') {
    const target = item.habit.targetPerWeek ?? 1
    return `${target}× per week`
  }
  if (item.frequency === 'custom') return describeDays(item.habit.daysOfWeek)
  return HABIT_FREQUENCY_LABELS[item.frequency]
}

export function HabitRow({
  item,
  selected = false,
  dragging = false,
  onToggle,
  onOpen,
  onEdit,
  onArchive,
  onDelete,
  onSelect,
  handle,
}: HabitRowProps) {
  const { habit, completedToday, scheduledToday } = item
  const accent = projectColorVar(habit.color)
  const archived = habit.archivedAt !== null

  const state = !scheduledToday
    ? 'not scheduled today'
    : completedToday
      ? 'done today'
      : 'due today'

  return (
    <div
      data-habit-id={habit.id}
      data-selected={selected || undefined}
      onMouseDown={onSelect}
      className={cn(
        'group/row relative flex items-start gap-2.5 rounded-md border px-2 py-2 sm:px-2.5',
        'transition-colors duration-[var(--duration-fast)]',
        selected
          ? 'border-accent-line bg-accent-soft/60'
          : 'border-transparent hover:border-line hover:bg-surface',
        archived && 'opacity-70',
        dragging && 'opacity-40',
      )}
    >
      {handle}

      <button
        type="button"
        role="checkbox"
        aria-checked={completedToday}
        disabled={!scheduledToday}
        aria-label={
          scheduledToday
            ? completedToday
              ? `Undo ${habit.name} for today`
              : `Complete ${habit.name} for today`
            : `${habit.name} is not scheduled today`
        }
        onClick={onToggle}
        className={cn(
          'mt-[2px] grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border',
          'transition-colors duration-[var(--duration-fast)]',
          !scheduledToday
            ? 'cursor-default border-dashed border-line text-transparent'
            : completedToday
              ? 'border-transparent text-accent-ink'
              : 'border-line-strong text-transparent hover:border-accent hover:text-accent/40',
        )}
        style={completedToday && scheduledToday ? { backgroundColor: accent } : undefined}
      >
        <Check size={12} strokeWidth={3} aria-hidden />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button
            type="button"
            onClick={onOpen}
            title={habit.name}
            className={cn(
              'min-w-0 max-w-full truncate text-left text-[13.5px] font-medium leading-snug',
              completedToday ? 'text-ink-2' : 'text-ink',
              'hover:text-accent',
            )}
          >
            {habit.name}
          </button>

          <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-[10.5px] text-ink-3">
            {scheduleText(item)}
          </span>

          {/* State in words as well as in the control's own aria-checked. */}
          <span className="sr-only">{state}</span>

          {!scheduledToday && !archived ? (
            <span className="shrink-0 text-[10.5px] text-ink-3">Not today</span>
          ) : null}

          {archived ? (
            <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-[10.5px] text-ink-3">
              Archived
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
          <span className="tabular inline-flex items-center gap-1 whitespace-nowrap text-ink-3">
            <Flame size={11} aria-hidden />
            <span aria-label={`Current streak ${item.currentStreak}`}>{item.currentStreak}</span>
            <span className="text-ink-3">streak</span>
          </span>

          <span
            className="tabular whitespace-nowrap text-ink-3"
            aria-label={`${item.rate.completed} of ${item.rate.scheduled} scheduled days completed, ${item.rate.percent} percent`}
          >
            <span className="text-ink-2">{item.rate.percent}%</span> of {item.rate.scheduled}{' '}
            {item.rate.scheduled === 1 ? 'day' : 'days'}
          </span>

          <HabitHistoryStrip
            name={habit.name}
            days={item.history.slice(-14)}
            className="hidden sm:flex"
          />
        </div>
      </div>

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity',
          'focus-within:opacity-100 group-hover/row:opacity-100',
          selected && 'opacity-100',
        )}
      >
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${habit.name}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-elevated hover:text-ink"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          onClick={onArchive}
          aria-label={archived ? `Restore ${habit.name}` : `Archive ${habit.name}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-elevated hover:text-ink"
        >
          {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${habit.name}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
