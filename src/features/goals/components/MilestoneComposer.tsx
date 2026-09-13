import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { Milestone } from '@/types/entities'
import {
  emptyMilestoneForm,
  milestoneForm,
  milestoneFormError,
  type MilestoneFormValue,
} from '../goalFormValue'

/**
 * Create and edit a milestone — one component, two modes.
 *
 * Two fields, and deliberately no third. There is no goal picker: a milestone
 * belongs to the goal it was created under and cannot be moved, because moving
 * it would silently reassign every task pointing at it to a different goal.
 * There is no "done" control either — the checkbox in the list is where a
 * checkpoint is met, so that action emits `milestone.completed` rather than a
 * generic save.
 */

const FIELD =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-strong text-ink placeholder:text-ink-3 focus:border-accent-line'

export function MilestoneComposer({
  milestone,
  goalTitle,
  busy = false,
  onSubmit,
  onCancel,
}: {
  /** `null` creates a checkpoint under `goalTitle`; a milestone edits one. */
  milestone: Milestone | null
  goalTitle: string
  busy?: boolean
  onSubmit: (value: MilestoneFormValue) => void
  onCancel: () => void
}) {
  const editing = milestone !== null
  const ids = useId()
  const titleRef = useRef<HTMLInputElement>(null)

  const [value, setValue] = useState<MilestoneFormValue>(() =>
    milestone ? milestoneForm(milestone) : emptyMilestoneForm(),
  )
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    setValue(milestone ? milestoneForm(milestone) : emptyMilestoneForm())
    setTouched(false)
  }, [milestone])

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  const problem = milestoneFormError(value)

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
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Edit ${milestone.title}` : `New milestone in ${goalTitle}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-elevated p-4 shadow-xl [animation:panel-in_var(--duration-base)_var(--ease-out)]"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-strong font-semibold tracking-tight text-ink">
              {editing ? 'Edit milestone' : 'New milestone'}
            </h2>
            <p className="truncate text-meta text-ink-3">{goalTitle}</p>
          </div>
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
          <label htmlFor={`${ids}-title`} className="t-eyebrow text-ink-3">
            Checkpoint
          </label>
          <input
            id={`${ids}-title`}
            ref={titleRef}
            value={value.title}
            onChange={(event) => setValue((v) => ({ ...v, title: event.target.value }))}
            placeholder="Finish trees and graphs"
            className={FIELD}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-date`} className="t-eyebrow text-ink-3">
            Target date
          </label>
          <input
            id={`${ids}-date`}
            type="date"
            value={value.targetDate}
            onChange={(event) => setValue((v) => ({ ...v, targetDate: event.target.value }))}
            className={FIELD}
          />
        </div>

        {touched && problem ? (
          <p
            role="alert"
            className="inline-flex items-center gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-body text-danger"
          >
            <AlertCircle size={12} aria-hidden />
            {problem}
          </p>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          <Button variant="primary" size="sm" disabled={busy} onClick={submit}>
            {editing ? 'Save' : 'Add milestone'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
