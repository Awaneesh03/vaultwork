import { cn } from '@/lib/cn'
import { formatFullDate } from '@/lib/date'
import type { CalendarDay } from '@/services'
import type { DateStr, Project, Task } from '@/types/entities'
import { CalendarTaskChip } from './CalendarTaskChip'

/**
 * One day as a plain list.
 *
 * This is what the week view becomes below `lg`. A seven-column time axis on a
 * phone gives each day about forty pixels, which is not a calendar — it is a
 * grid you cannot read. Stacking the days keeps every task legible and every
 * control tappable, which is the point of the week view in the first place.
 */
export function DayAgenda({
  day,
  today,
  projects,
  selected,
  onOpenTask,
  onToggleTask,
  onSelectDay,
}: {
  day: CalendarDay
  today: DateStr
  projects: Project[]
  selected: boolean
  onOpenTask: (task: Task) => void
  onToggleTask: (task: Task) => void
  onSelectDay: (date: DateStr) => void
}) {
  return (
    <section
      aria-label={formatFullDate(day.date)}
      className={cn(
        'rounded-lg border bg-surface',
        selected ? 'border-accent-line' : 'border-line',
      )}
    >
      <button
        type="button"
        onClick={() => onSelectDay(day.date)}
        aria-current={day.isToday ? 'date' : undefined}
        className="flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left"
      >
        <span
          className={cn(
            'text-[12.5px]',
            day.isToday ? 'font-semibold text-accent' : 'text-ink',
          )}
        >
          {formatFullDate(day.date)}
        </span>
        {day.isToday ? (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
            Today
          </span>
        ) : null}
        <span className="flex-1" />
        {day.tasks.length > 0 ? (
          <span className="tabular text-[10.5px] text-ink-3">{day.tasks.length}</span>
        ) : null}
      </button>

      {day.tasks.length === 0 ? (
        <p className="px-3 py-2 text-[11.5px] text-ink-3">Nothing scheduled.</p>
      ) : (
        <div className="flex flex-col gap-1 p-2">
          {day.tasks.map((task) => (
            <CalendarTaskChip
              key={task.id}
              task={task}
              today={today}
              projects={projects}
              draggable={false}
              onOpen={onOpenTask}
              onToggle={onToggleTask}
            />
          ))}
        </div>
      )}
    </section>
  )
}
