import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import type { Goal } from '@/types/entities'
import type { GoalHorizon } from '@/types/enums'
import {
  emptyGoalForm,
  goalForm,
  goalFormError,
  type GoalFormValue,
} from '../goalFormValue'

/**
 * Create and edit a goal — one component, two modes.
 *
 * Four fields, matching the model exactly: title, why, horizon and target date.
 * There is nothing here for status, because status is changed by *doing*
 * something (completing, archiving) rather than by picking from a dropdown, and
 * nothing for progress, because progress is derived and never stored.
 *
 * Editing keeps the goal's id, and saving never touches a milestone or a task —
 * renaming a goal or pulling its deadline forward leaves every completion
 * exactly as it was recorded.
 */

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

export function GoalComposer({
  goal,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: {
  /** `null` creates; a goal edits it in place, keeping its id. */
  goal: Goal | null
  busy?: boolean
  error?: string | null
  onSubmit: (value: GoalFormValue) => void
  onCancel: () => void
}) {
  const editing = goal !== null
  const ids = useId()
  const titleRef = useRef<HTMLInputElement>(null)

  const [value, setValue] = useState<GoalFormValue>(() =>
    goal ? goalForm(goal) : emptyGoalForm(),
  )
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    setValue(goal ? goalForm(goal) : emptyGoalForm())
    setTouched(false)
  }, [goal])

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  const set = <K extends keyof GoalFormValue>(key: K, next: GoalFormValue[K]) =>
    setValue((current) => ({ ...current, [key]: next }))

  const problem = goalFormError(value)
  const shown = touched ? (error ?? problem) : error

  const submit = () => {
    setTouched(true)
    if (problem !== null) {
      titleRef.current?.focus()
      return
    }
    onSubmit(value)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Edit ${goal.title}` : 'New goal'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
        }}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-line bg-elevated p-4 shadow-xl [animation:panel-in_var(--duration-base)_var(--ease-out)]"
      >
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[14px] font-semibold tracking-tight text-ink">
            {editing ? 'Edit goal' : 'New goal'}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 hover:bg-surface hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-title`}>Outcome</Label>
          <input
            id={`${ids}-title`}
            ref={titleRef}
            value={value.title}
            onChange={(event) => set('title', event.target.value)}
            placeholder="Become strong in DSA"
            className={FIELD}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-why`}>Why</Label>
          <textarea
            id={`${ids}-why`}
            value={value.why}
            onChange={(event) => set('why', event.target.value)}
            rows={2}
            placeholder="What makes this worth doing?"
            className={`${FIELD} resize-none`}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[140px] flex-1 flex-col gap-1">
            <Label htmlFor={`${ids}-horizon`}>Horizon</Label>
            <select
              id={`${ids}-horizon`}
              value={value.horizon}
              onChange={(event) => set('horizon', event.target.value as GoalHorizon)}
              className={FIELD}
            >
              <option value="short">Short</option>
              <option value="long">Long</option>
            </select>
          </div>

          <div className="flex min-w-[140px] flex-1 flex-col gap-1">
            <Label htmlFor={`${ids}-target`}>Target date</Label>
            <input
              id={`${ids}-target`}
              type="date"
              value={value.targetDate}
              onChange={(event) => set('targetDate', event.target.value)}
              className={FIELD}
            />
          </div>
        </div>

        {shown ? (
          <p
            role="alert"
            className="inline-flex items-center gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger"
          >
            <AlertCircle size={12} aria-hidden />
            {shown}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" size="sm" disabled={busy} onClick={submit}>
            {editing ? 'Save' : 'Create goal'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <span className="flex-1" />
          <span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:inline-flex">
            <Kbd>esc</Kbd> to close
          </span>
        </div>
      </div>
    </div>
  )
}
