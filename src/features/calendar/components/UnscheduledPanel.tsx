import { Inbox } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { DateStr, Project, Task } from '@/types/entities'
import { CalendarTaskChip } from './CalendarTaskChip'

/**
 * Tasks with no due date.
 *
 * They are deliberately *not* on the grid: a task with no date does not belong
 * on one, and quietly parking it on "today" would invent a commitment the user
 * never made. Instead they sit beside the calendar where they can be dragged
 * onto a day — which is the moment they acquire a date, through the same
 * reschedule path every other surface uses.
 */
export function UnscheduledPanel({
  tasks,
  total,
  today,
  projects,
  onOpenTask,
  onToggleTask,
  className,
}: {
  tasks: Task[]
  total: number
  today: DateStr
  projects: Project[]
  onOpenTask: (task: Task) => void
  onToggleTask: (task: Task) => void
  className?: string
}) {
  return (
    <section
      aria-label="Unscheduled"
      className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-surface', className)}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Inbox size={12} className="text-ink-3" aria-hidden />
        <h3 className="t-eyebrow text-ink-3">Unscheduled</h3>
        {total > 0 ? (
          <span className="tabular rounded-sm bg-sunken px-1.5 text-[10px] text-ink-2">
            {total}
          </span>
        ) : null}
      </header>

      {tasks.length === 0 ? (
        <p className="px-3 py-2.5 text-[12px] text-ink-3">Everything has a date.</p>
      ) : (
        <div className="flex max-h-[240px] flex-col gap-1 overflow-y-auto p-2">
          {tasks.map((task) => (
            <CalendarTaskChip
              key={task.id}
              task={task}
              today={today}
              projects={projects}
              showTime={false}
              onOpen={onOpenTask}
              onToggle={onToggleTask}
            />
          ))}
          {total > tasks.length ? (
            <p className="px-1 pt-0.5 text-[10.5px] text-ink-3">
              {total - tasks.length} more not shown
            </p>
          ) : null}
        </div>
      )}

      <p className="border-t border-line px-3 py-1.5 text-[10.5px] text-ink-3">
        Drag onto a day to schedule it.
      </p>
    </section>
  )
}
