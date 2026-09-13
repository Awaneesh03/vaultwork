import { useEffect, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/cn'
import {
  formatFullDate,
  formatHour,
  formatTime,
  minutesToTime,
  timeToMinutes,
  weekdayName,
} from '@/lib/date'
import { HOUR_HEIGHT } from '../calendarLayout'
import { axisHours, slotOffsets } from '@/lib/calendar'
import type { CalendarDay } from '@/services'
import type { DateStr, Project, Task, TimeStr } from '@/types/entities'
import { CalendarTaskChip } from './CalendarTaskChip'

/**
 * The time axis and one column per day. Shared by Week and Day.
 *
 * Placement is arithmetic, not layout luck: a task's top is
 * `timeToMinutes(dueTime) / 60 * HOUR_HEIGHT`, so 19:00 is nineteen hour-rows
 * down by construction. `HOUR_HEIGHT` is the single pixel constant, and the
 * drop handler divides by the same number to turn a pointer position back into
 * a time — one conversion, used in both directions.
 *
 * All-day tasks sit in a gutter above the axis rather than being faked to
 * midnight. A task due "Friday" is not a task due at 00:00 on Friday, and
 * drawing it there would invent a time the user never set.
 */

export interface CalendarTimeGridProps {
  days: CalendarDay[]
  today: DateStr
  projects: Project[]
  selectedDate: DateStr | null
  /** Height of the estimate-less task block, in minutes. */
  onOpenTask: (task: Task) => void
  onToggleTask: (task: Task) => void
  onSelectDay: (date: DateStr) => void
  /** Called when an empty slot is clicked, to create a task there. */
  onPickSlot: (date: DateStr, time: TimeStr) => void
}

/**
 * One quarter-hour: a drop target and a click-to-create affordance.
 *
 * The slot carries its own time in its droppable id, so a drop resolves to an
 * exact quarter with no pixel arithmetic — which is what makes the result
 * independent of where the chip was grabbed and of any auto-scrolling the drag
 * caused. Clicking it starts a task at that same time.
 */
function Slot({
  date,
  minutes,
  onPick,
}: {
  date: DateStr
  minutes: number
  onPick: (time: TimeStr) => void
}) {
  const time = minutesToTime(minutes)
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${date}:${time}` })
  const onTheHour = minutes % 60 === 0

  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={() => onPick(time)}
      aria-label={`Add a task on ${formatFullDate(date)} at ${formatTime(time)}`}
      style={{ height: HOUR_HEIGHT / 4 }}
      className={cn(
        'block w-full transition-colors hover:bg-elevated',
        onTheHour ? 'border-t border-line/60' : '',
        isOver && 'bg-accent-soft',
      )}
    />
  )
}

/** Where the axis opens: an hour before now on a day that includes today. */
const DEFAULT_TOP_HOUR = 7

export function CalendarTimeGrid({
  days,
  today,
  projects,
  selectedDate,
  onOpenTask,
  onToggleTask,
  onSelectDay,
  onPickSlot,
}: CalendarTimeGridProps) {
  const hours = axisHours()
  const hasAllDay = days.some((day) => day.allDay.length > 0)
  const scroller = useRef<HTMLDivElement>(null)

  /*
   * Open the axis somewhere useful rather than at midnight.
   *
   * Scroll position is decoration, so reading the wall clock here is safe for
   * the same reason the "now" line does: nothing is computed or stored from it,
   * and every date the calendar reasons about still comes from the clock port.
   * It runs once per period so it never fights a scroll the user made.
   */
  const period = `${days[0]?.date ?? ''}:${days.length}`
  const showsToday = days.some((day) => day.isToday)

  useEffect(() => {
    const node = scroller.current
    if (!node) return
    const hour = showsToday ? Math.max(0, new Date().getHours() - 1) : DEFAULT_TOP_HOUR
    node.scrollTop = hour * HOUR_HEIGHT
  }, [period, showsToday])

  return (
    <div className="overflow-hidden panel">
      {/* Day headers */}
      <div
        className="grid border-b border-line bg-sunken"
        style={{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div aria-hidden />
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            onClick={() => onSelectDay(day.date)}
            aria-label={`Select ${formatFullDate(day.date)}${day.isToday ? ', today' : ''}`}
            aria-current={day.isToday ? 'date' : undefined}
            className={cn(
              'flex flex-col items-center gap-0.5 border-l border-line px-1 py-1.5',
              'transition-colors hover:bg-elevated',
              day.date === selectedDate && 'bg-accent-soft',
            )}
          >
            <span className="t-eyebrow text-ink-3">{weekdayName(day.date).slice(0, 3)}</span>
            <span
              className={cn(
                'tabular grid h-[20px] min-w-[20px] place-items-center rounded-full px-1 text-body',
                day.isToday ? 'bg-accent font-semibold text-accent-ink' : 'text-ink',
              )}
            >
              {Number(day.date.slice(8))}
            </span>
            {day.isToday ? (
              <span className="font-mono text-micro font-semibold uppercase tracking-[0.1em] text-accent">
                Today
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* All-day gutter — only when something is in it. */}
      {hasAllDay ? (
        <div
          className="grid border-b border-line"
          style={{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div className="px-1 py-1 text-right font-mono text-micro uppercase tracking-[0.1em] text-ink-3">
            All day
          </div>
          {days.map((day) => (
            <div key={day.date} className="flex min-w-0 flex-col gap-0.5 border-l border-line p-1">
              {day.allDay.map((task) => (
                <CalendarTaskChip
                  key={task.id}
                  task={task}
                  today={today}
                  projects={projects}
                  showTime={false}
                  compact
                  onOpen={onOpenTask}
                  onToggle={onToggleTask}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {/* The axis itself, scrollable so a full 24 hours does not own the page. */}
      <div ref={scroller} className="max-h-[58vh] overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div>
            {hours.map((hour) => (
              <div
                key={hour}
                style={{ height: HOUR_HEIGHT }}
                className="relative border-b border-line/60"
              >
                <span className="tabular absolute -top-[6px] right-1 bg-surface px-0.5 text-micro text-ink-3">
                  {hour === 0 ? '' : formatHour(hour)}
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => (
            <div key={day.date} className="relative min-w-0 border-l border-line">
              {hours.flatMap((hour) =>
                slotOffsets().map((offset) => (
                  <Slot
                    key={`${hour}:${offset}`}
                    date={day.date}
                    minutes={hour * 60 + offset}
                    onPick={(time) => onPickSlot(day.date, time)}
                  />
                )),
              )}

              {day.timed.map((task) => {
                const minutes = timeToMinutes(task.dueTime as TimeStr)
                const height = Math.max(18, ((task.estimateMin ?? 30) / 60) * HOUR_HEIGHT)
                return (
                  <CalendarTaskChip
                    key={task.id}
                    task={task}
                    today={today}
                    projects={projects}
                    onOpen={onOpenTask}
                    onToggle={onToggleTask}
                    className="absolute left-0.5 right-0.5 items-start overflow-hidden"
                    style={{ top: (minutes / 60) * HOUR_HEIGHT, height }}
                  />
                )
              })}

              {/* A hairline at the current time, on today's column only. */}
              {day.isToday ? <NowLine /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The "now" marker.
 *
 * It reads the wall clock directly and deliberately: this is a decoration on a
 * rendered grid, not a domain fact, and nothing is computed or stored from it.
 * Every date the calendar actually reasons about still comes from the clock
 * port through the view model.
 */
function NowLine() {
  const now = new Date()
  const top = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 right-0 z-10 border-t border-accent"
      style={{ top }}
    >
      <span className="absolute -left-[3px] -top-[3px] h-1.5 w-1.5 rounded-full bg-accent" />
    </div>
  )
}
