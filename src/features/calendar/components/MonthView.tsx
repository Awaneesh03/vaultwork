import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/cn'
import { formatFullDate, weekdayHeadings } from '@/lib/date'
import type { CalendarData, CalendarDay } from '@/services'
import type { DateStr, Project, Task } from '@/types/entities'
import { CalendarTaskChip } from './CalendarTaskChip'

/**
 * The month grid.
 *
 * The grid is built from the view model's rows, never from arithmetic done
 * here, so weekday alignment, adjacent-month padding and the row count are all
 * decided in one tested place.
 *
 * Two things are worth calling out.
 *
 * **A cell never grows.** Its height is fixed and it shows what fits; the rest
 * collapses into "+N more", which opens that day. A month where one busy
 * Tuesday stretches the whole row is a month you cannot scan.
 *
 * **Below `sm` it stops pretending.** Seven columns on a 375px screen leaves
 * about fifty pixels each, which is not enough for a title — so the chips give
 * way to one dot per task. The month still answers "which days are busy?",
 * which is the only question a month grid can answer at that size.
 */

const MAX_CHIPS = 3

export interface MonthViewProps {
  data: CalendarData
  selectedDate: DateStr | null
  onSelectDay: (date: DateStr) => void
  onOpenDay: (date: DateStr) => void
  onOpenTask: (task: Task) => void
  onToggleTask: (task: Task) => void
}

function DayCell({
  day,
  selected,
  projects,
  today,
  onSelect,
  onOpenDay,
  onOpenTask,
  onToggleTask,
}: {
  day: CalendarDay
  selected: boolean
  projects: Project[]
  today: DateStr
  onSelect: () => void
  onOpenDay: () => void
  onOpenTask: (task: Task) => void
  onToggleTask: (task: Task) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `date:${day.date}` })

  const shown = day.tasks.slice(0, MAX_CHIPS)
  const hidden = day.tasks.length - shown.length

  const label = [
    formatFullDate(day.date),
    day.isToday ? 'today' : null,
    day.tasks.length === 0
      ? 'no tasks'
      : `${day.tasks.length} ${day.tasks.length === 1 ? 'task' : 'tasks'}`,
    day.overdueCount > 0 ? `${day.overdueCount} overdue` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-selected={selected}
      aria-label={label}
      className={cn(
        'flex min-h-[92px] min-w-0 flex-col gap-0.5 border-b border-r border-line p-1',
        'transition-colors duration-[var(--duration-fast)]',
        day.isCurrentMonth ? 'bg-surface' : 'bg-canvas',
        day.isWeekend && day.isCurrentMonth && 'bg-sunken/40',
        selected && 'ring-1 ring-inset ring-accent',
        isOver && 'bg-accent-soft',
      )}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={onOpenDay}
          aria-label={`Select ${formatFullDate(day.date)}`}
          className={cn(
            'tabular grid h-[19px] min-w-[19px] shrink-0 place-items-center rounded-full px-1 text-[11px]',
            'transition-colors duration-[var(--duration-fast)]',
            day.isToday
              ? 'bg-accent font-semibold text-accent-ink'
              : day.isCurrentMonth
                ? 'text-ink hover:bg-elevated'
                : 'text-ink-3 hover:bg-elevated',
          )}
        >
          {Number(day.date.slice(8))}
        </button>

        {/* "Today" in words as well as in colour. */}
        {day.isToday ? (
          <span className="hidden font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accent sm:inline">
            Today
          </span>
        ) : null}

        <span className="flex-1" />

        {day.overdueCount > 0 ? (
          <span
            className="tabular hidden shrink-0 rounded-sm bg-danger-soft px-1 text-[9px] text-danger sm:inline"
            title={`${day.overdueCount} overdue`}
          >
            {day.overdueCount}!
          </span>
        ) : null}
      </div>

      {/* Below `sm`: one dot per task, because a title has nowhere to go. */}
      <div className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden>
        {day.tasks.slice(0, 4).map((task) => (
          <span
            key={task.id}
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              task.status === 'done'
                ? 'bg-ink-3'
                : task.dueDate !== null && task.dueDate < today
                  ? 'bg-danger'
                  : 'bg-accent',
            )}
          />
        ))}
        {day.tasks.length > 4 ? (
          <span className="tabular text-[10px] text-ink-3">+{day.tasks.length - 4}</span>
        ) : null}
      </div>

      <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
        {shown.map((task) => (
          <CalendarTaskChip
            key={task.id}
            task={task}
            today={today}
            projects={projects}
            compact
            onOpen={onOpenTask}
            onToggle={onToggleTask}
          />
        ))}

        {hidden > 0 ? (
          <button
            type="button"
            onClick={onOpenDay}
            aria-label={`Show all ${day.tasks.length} tasks on ${formatFullDate(day.date)}`}
            className="rounded px-1 text-left text-[10px] text-ink-3 hover:bg-elevated hover:text-accent"
          >
            +{hidden} more
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function MonthView({
  data,
  selectedDate,
  onSelectDay,
  onOpenDay,
  onOpenTask,
  onToggleTask,
}: MonthViewProps) {
  const headings = weekdayHeadings(data.weekStartsOn)

  return (
    <div
      role="grid"
      aria-label={`${data.title}, month view`}
      className="overflow-hidden rounded-lg border-l border-t border-line"
    >
      <div role="row" className="grid grid-cols-7">
        {headings.map((name) => (
          <div
            key={name}
            role="columnheader"
            className="border-b border-r border-line bg-sunken px-1 py-1.5 text-center t-eyebrow text-ink-3"
          >
            <span className="hidden sm:inline">{name.slice(0, 3)}</span>
            <span className="sm:hidden">{name.slice(0, 1)}</span>
          </div>
        ))}
      </div>

      {data.weeks.map((week) => (
        <div role="row" key={week[0]?.date} className="grid grid-cols-7">
          {week.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              today={data.today}
              projects={data.projects}
              selected={day.date === selectedDate}
              onSelect={() => onSelectDay(day.date)}
              onOpenDay={() => onOpenDay(day.date)}
              onOpenTask={onOpenTask}
              onToggleTask={onToggleTask}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
