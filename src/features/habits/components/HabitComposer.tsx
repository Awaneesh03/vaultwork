import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import {
  PROJECT_COLORS,
  PROJECT_COLOR_LABELS,
  projectColorVar,
} from '@/features/projects/projectAppearance'
import type { HabitFrequency } from '@/services'
import type { Habit } from '@/types/entities'
import { WEEKDAY_INITIALS, WEEKDAY_NAMES } from '../habitAppearance'
import {
  emptyHabitForm,
  habitForm,
  habitFormError,
  type HabitFormValue,
} from '../habitFormValue'

/**
 * Create and edit a habit — one component, two modes.
 *
 * The four frequencies are a *presentation* of the model's two fields, not a
 * second schema: picking "Weekdays" writes `daysOfWeek: [1..5]`, picking
 * "Times per week" writes `cadence: 'weekly'` with a target. The form only ever
 * shows the controls the chosen frequency actually uses, so it is impossible to
 * submit a weekly habit that also claims particular days.
 *
 * Editing keeps the habit's id, and saving never touches a single entry —
 * changing a Monday habit to weekdays leaves last month's Mondays exactly as
 * they were recorded.
 */

const FREQUENCIES: { id: HabitFrequency; label: string; hint: string }[] = [
  { id: 'daily', label: 'Every day', hint: 'Expected every day' },
  { id: 'weekdays', label: 'Weekdays', hint: 'Monday to Friday' },
  { id: 'custom', label: 'Custom days', hint: 'Pick the days' },
  { id: 'weekly', label: 'Times per week', hint: 'Any days, a target count' },
]

const FIELD =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent-line'

function Label({ htmlFor, children }: { htmlFor?: string; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="t-eyebrow text-ink-3"
    >
      {children}
    </label>
  )
}

export function HabitComposer({
  habit,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: {
  /** `null` creates; a habit edits it in place, keeping its id. */
  habit: Habit | null
  busy?: boolean
  error?: string | null
  onSubmit: (value: HabitFormValue) => void
  onCancel: () => void
}) {
  const editing = habit !== null
  const ids = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  const [value, setValue] = useState<HabitFormValue>(() =>
    habit ? habitForm(habit) : emptyHabitForm(),
  )
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    setValue(habit ? habitForm(habit) : emptyHabitForm())
    setTouched(false)
  }, [habit])

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const set = <K extends keyof HabitFormValue>(key: K, next: HabitFormValue[K]) =>
    setValue((current) => ({ ...current, [key]: next }))

  const toggleDay = (day: number) =>
    setValue((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((value_) => value_ !== day)
        : [...current.daysOfWeek, day].sort(),
    }))

  const invalid = habitFormError(value)
  const message = error ?? (touched ? invalid : null)

  const submit = () => {
    setTouched(true)
    if (invalid) {
      nameRef.current?.focus()
      return
    }
    onSubmit(value)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-[8vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Edit ${habit.name}` : 'New habit'}
        className="w-full max-w-md rounded-lg border border-line bg-elevated shadow-xl"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="flex-1 text-[14px] font-semibold tracking-tight text-ink">
            {editing ? 'Edit habit' : 'New habit'}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 hover:bg-surface hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex flex-col gap-3.5 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-name`}>Name</Label>
            <input
              id={`${ids}-name`}
              ref={nameRef}
              value={value.name}
              onChange={(event) => set('name', event.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Read 20 pages"
              autoComplete="off"
              aria-invalid={message !== null}
              aria-describedby={message ? `${ids}-error` : undefined}
              className={cn(FIELD, message && 'border-danger')}
            />
            {message ? (
              <p
                id={`${ids}-error`}
                role="alert"
                className="inline-flex items-center gap-1 text-[11.5px] text-danger"
              >
                <AlertCircle size={11} aria-hidden />
                {message}
              </p>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="t-eyebrow text-ink-3">
              Frequency
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {FREQUENCIES.map((frequency) => (
                <button
                  key={frequency.id}
                  type="button"
                  onClick={() => set('frequency', frequency.id)}
                  aria-pressed={value.frequency === frequency.id}
                  title={frequency.hint}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-left text-[12.5px] transition-colors',
                    value.frequency === frequency.id
                      ? 'border-accent bg-accent-soft text-ink'
                      : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                  )}
                >
                  {frequency.label}
                </button>
              ))}
            </div>
          </fieldset>

          {value.frequency === 'custom' ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="t-eyebrow text-ink-3">
                Days
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_INITIALS.map((initial, day) => {
                  const on = value.daysOfWeek.includes(day)
                  return (
                    <button
                      key={WEEKDAY_NAMES[day]}
                      type="button"
                      onClick={() => toggleDay(day)}
                      aria-pressed={on}
                      aria-label={WEEKDAY_NAMES[day] ?? ''}
                      className={cn(
                        'grid h-7 w-7 place-items-center rounded-md border text-[12px] transition-colors',
                        on
                          ? 'border-accent bg-accent-soft font-medium text-ink'
                          : 'border-line text-ink-3 hover:border-line-strong hover:text-ink',
                      )}
                    >
                      {initial}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ) : null}

          {value.frequency === 'weekly' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-target`}>Times per week</Label>
              <input
                id={`${ids}-target`}
                type="number"
                min={1}
                max={7}
                value={value.targetPerWeek}
                onChange={(event) => set('targetPerWeek', event.target.value)}
                className={cn(FIELD, 'max-w-[110px]')}
              />
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-1.5">
            <legend className="t-eyebrow text-ink-3">
              Accent
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => set('color', color)}
                  aria-pressed={value.color === color}
                  aria-label={PROJECT_COLOR_LABELS[color]}
                  title={PROJECT_COLOR_LABELS[color]}
                  className={cn(
                    'h-6 w-6 rounded-md border-2 transition-transform',
                    value.color === color
                      ? 'scale-105 border-ink'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: projectColorVar(color) }}
                />
              ))}
            </div>
          </fieldset>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          <span className="flex-1 text-[11px] text-ink-3">
            <Kbd>esc</Kbd> to cancel
          </span>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {editing ? 'Save habit' : 'Create habit'}
          </Button>
        </footer>
      </form>
    </div>
  )
}
