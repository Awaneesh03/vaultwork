import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import type { Project } from '@/types/entities'
import type { ProjectStatus } from '@/types/enums'
import {
  EDITABLE_PROJECT_STATUSES,
  PROJECT_COLORS,
  PROJECT_COLOR_LABELS,
  PROJECT_ICONS,
  PROJECT_ICON_LABELS,
  PROJECT_STATUS_LABELS,
  projectColorVar,
  projectIcon,
} from '../projectAppearance'
import {
  emptyProjectForm,
  projectForm,
  projectFormError,
  type ProjectFormValue,
} from '../projectFormValue'

/**
 * Create and edit a project — one component, two modes.
 *
 * Editing and creating differ in exactly two ways: the title, and whether a
 * project id exists. A second component would be a second place for the same
 * validation to be wrong, and the mode is what guarantees an edit *cannot*
 * create a row — `onSubmit` hands back a value, and the screen above decides
 * which intent to build from it.
 *
 * Every field is a real labelled control inside a `<form>`, so Enter submits,
 * Escape cancels, and Tab walks it in order. Typing here never triggers a
 * global shortcut: `isEditableTarget` in the keyboard layer refuses every
 * event that came from an input, which is why the "p" in "Portfolio" does not
 * navigate away mid-word.
 */

export interface ProjectComposerProps {
  /** `null` creates; a project edits it in place, keeping its id. */
  project: Project | null
  busy?: boolean
  /** Set when the service refused the save — a duplicate name, normally. */
  error?: string | null
  onSubmit: (value: ProjectFormValue) => void
  onCancel: () => void
}

const FIELD =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent-line'

function Label({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="t-eyebrow text-ink-3">
      {children}
    </label>
  )
}

export function ProjectComposer({
  project,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: ProjectComposerProps) {
  const editing = project !== null
  const ids = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  const [value, setValue] = useState<ProjectFormValue>(() =>
    project ? projectForm(project) : emptyProjectForm(),
  )
  const [touched, setTouched] = useState(false)

  // Reload when the composer is pointed at a different project rather than
  // remounted: the form must never show the previous project's name.
  useEffect(() => {
    setValue(project ? projectForm(project) : emptyProjectForm())
    setTouched(false)
  }, [project])

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const set = <K extends keyof ProjectFormValue>(key: K, next: ProjectFormValue[K]) =>
    setValue((current) => ({ ...current, [key]: next }))

  const invalid = projectFormError(value)
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
        aria-label={editing ? `Edit ${project.name}` : 'New project'}
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
            {editing ? 'Edit project' : 'New project'}
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
              placeholder="College"
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-description`}>Description</Label>
            <textarea
              id={`${ids}-description`}
              value={value.description}
              onChange={(event) => set('description', event.target.value)}
              rows={2}
              placeholder="What this project is for."
              className={cn(FIELD, 'resize-y')}
            />
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-status`}>Status</Label>
              <select
                id={`${ids}-status`}
                value={value.status}
                onChange={(event) => set('status', event.target.value as ProjectStatus)}
                className={FIELD}
              >
                {EDITABLE_PROJECT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {PROJECT_STATUS_LABELS[status]}
                  </option>
                ))}
                {/* An archived project keeps its status visible while editing;
                    leaving the archive is a button, not a dropdown value. */}
                {value.status === 'archived' ? (
                  <option value="archived">{PROJECT_STATUS_LABELS.archived}</option>
                ) : null}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-deadline`}>Deadline</Label>
              <input
                id={`${ids}-deadline`}
                type="date"
                value={value.deadline}
                onChange={(event) => set('deadline', event.target.value)}
                className={FIELD}
              />
            </div>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="t-eyebrow text-ink-3">Accent</legend>
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
                      ? 'border-ink scale-105'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: projectColorVar(color) }}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="t-eyebrow text-ink-3">Icon</legend>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_ICONS.map((name) => {
                const Icon = projectIcon(name)
                const active = value.icon === name
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => set('icon', name)}
                    aria-pressed={active}
                    aria-label={PROJECT_ICON_LABELS[name]}
                    title={PROJECT_ICON_LABELS[name]}
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded-md border transition-colors',
                      active
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line text-ink-3 hover:border-line-strong hover:text-ink',
                    )}
                  >
                    <Icon size={14} aria-hidden />
                  </button>
                )
              })}
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
            {editing ? 'Save project' : 'Create project'}
          </Button>
        </footer>
      </form>
    </div>
  )
}
