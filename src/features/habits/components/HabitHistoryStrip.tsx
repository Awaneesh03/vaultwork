import { cn } from '@/lib/cn'
import { formatFullDate } from '@/lib/date'
import type { HabitDay } from '@/services'

/**
 * A habit's recent days, one cell each.
 *
 * The three states are drawn *and named* differently, never by colour alone: a
 * completed day is a filled cell reading "completed", a missed one is an
 * outlined cell reading "missed", and a day the habit was never owed is a faint
 * dash reading "not scheduled". That last distinction is the point of the whole
 * strip — a weekday habit must not look like it fails every weekend.
 *
 * No cell has a database row behind it unless it was actually completed. The
 * dashes are computed from the schedule, not stored.
 */
export function HabitHistoryStrip({
  name,
  days,
  className,
}: {
  name: string
  days: HabitDay[]
  className?: string
}) {
  return (
    <ul
      aria-label={`${name} — recent history`}
      className={cn('flex min-w-0 flex-wrap items-center gap-[3px]', className)}
    >
      {days.map((day) => {
        const state =
          day.state === 'done'
            ? 'completed'
            : day.state === 'missed'
              ? 'missed'
              : day.state === 'future'
                ? 'upcoming'
                : 'not scheduled'

        return (
          <li
            key={day.date}
            title={`${formatFullDate(day.date)} — ${state}`}
            aria-label={`${formatFullDate(day.date)}, ${state}`}
            className={cn(
              'h-[11px] w-[11px] shrink-0 rounded-[2px] border',
              day.state === 'done' && 'border-accent bg-accent',
              day.state === 'missed' && 'border-line-strong bg-transparent',
              day.state === 'future' && 'border-dashed border-line bg-transparent',
              day.state === 'off' && 'border-transparent bg-sunken',
            )}
          />
        )
      })}
    </ul>
  )
}
