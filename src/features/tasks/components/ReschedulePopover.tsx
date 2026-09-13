import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { addDays } from '@/lib/date'
import type { DateStr, Task } from '@/types/entities'

/**
 * The `D` shortcut's target: move a task's due date without opening the editor.
 *
 * The four presets cover almost every real reschedule; the date field is there
 * for the rest. A native `date` input rather than a custom calendar, for the
 * same reason as in the composer — it is already keyboard accessible.
 */
export function ReschedulePopover({
  task,
  today,
  onApply,
  onClose,
}: {
  task: Task
  today: DateStr
  onApply: (dueDate: DateStr | null) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(task.dueDate ?? '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
  }, [])

  const presets: { label: string; date: DateStr | null }[] = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next week', date: addDays(today, 7) },
    { label: 'No date', date: null },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[18vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Reschedule ${task.title}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        className="w-full max-w-xs rounded-lg border border-line bg-elevated p-3 shadow-xl"
      >
        <p className="mb-2 truncate text-[12.5px] text-ink-3" title={task.title}>
          {task.title}
        </p>

        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              size="sm"
              onClick={() => {
                onApply(preset.date)
                onClose()
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label="Due date"
            className="h-8 flex-1 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink focus:border-line-strong"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={value.length === 0}
            onClick={() => {
              onApply(value)
              onClose()
            }}
          >
            Set
          </Button>
        </div>
      </div>
    </div>
  )
}
