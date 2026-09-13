import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import type { Project, Subtask, Tag } from '@/types/entities'
import { PRIORITIES } from '@/types/enums'
import { PRIORITY_KEYS, PRIORITY_LABELS } from '../priority'
import type { ComposerValue } from '../composerValue'
import { DraftSubtaskList, SubtaskList } from './SubtaskList'
import { TagPicker } from './TagPicker'

/**
 * The full task form: every field the data model has, in one place.
 *
 * Quick Add covers the fast path; this covers the deliberate one. It is the
 * same component for creating and editing, because a form that disagrees with
 * itself between the two is a form with two sets of bugs.
 *
 * Native `date` and `time` inputs are used on purpose. They are keyboard
 * accessible, localised, and understood by every assistive technology — a
 * hand-built date picker would be worse at all three.
 */

const FIELD =
  'h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink focus:border-line-strong'

function Label({ children, htmlFor }: { children: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="t-eyebrow text-ink-3">
      {children}
    </label>
  )
}

export interface TaskComposerProps {
  mode: 'create' | 'edit'
  value: ComposerValue
  onChange: (value: ComposerValue) => void
  tags: Tag[]
  projects: Project[]
  onSubmit: () => void
  onCancel: () => void
  onCreateTag?: (name: string) => Promise<Tag | null>
  /** Edit mode: the real subtask rows and their operations. */
  subtasks?: Subtask[]
  onAddSubtask?: (title: string) => void
  onToggleSubtask?: (subtask: Subtask) => void
  onDeleteSubtask?: (subtask: Subtask) => void
  onMoveSubtask?: (fromIndex: number, toIndex: number) => void
  busy?: boolean
  autoFocus?: boolean
  /**
   * Opens the detail fields immediately.
   *
   * Create mode normally starts collapsed — a title is usually all you want.
   * The calendar sets this when a task is started from a specific date or time
   * slot, because a pre-filled due date the user cannot see is worse than no
   * pre-fill at all.
   */
  expandDetails?: boolean
}

export function TaskComposer({
  mode,
  value,
  onChange,
  tags,
  projects,
  onSubmit,
  onCancel,
  onCreateTag,
  subtasks,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onMoveSubtask,
  busy = false,
  autoFocus = false,
  expandDetails = false,
}: TaskComposerProps) {
  const titleRef = useRef<HTMLInputElement>(null)
  const [showMore, setShowMore] = useState(mode === 'edit' || expandDetails)

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus()
  }, [autoFocus])

  const set = <K extends keyof ComposerValue>(key: K, next: ComposerValue[K]) =>
    onChange({ ...value, [key]: next })

  const canSubmit = value.title.trim().length > 0 && !busy

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) onSubmit()
      }}
      onKeyDown={(event) => {
        // ⌘Enter saves from anywhere in the form, including the description.
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          if (canSubmit) onSubmit()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="task-title">Title</Label>
        <input
          id="task-title"
          ref={titleRef}
          value={value.title}
          onChange={(event) => set('title', event.target.value)}
          placeholder="What needs doing?"
          className={cn(FIELD, 'h-9 text-[14px]')}
          required
        />
      </div>

      {showMore ? (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor="task-description">Description</Label>
            <textarea
              id="task-description"
              value={value.description}
              onChange={(event) => set('description', event.target.value)}
              rows={3}
              placeholder="Anything worth remembering."
              className={cn(FIELD, 'h-auto resize-y py-2 leading-relaxed')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="task-due-date">Due date</Label>
              <input
                id="task-due-date"
                type="date"
                value={value.dueDate}
                onChange={(event) => set('dueDate', event.target.value)}
                className={FIELD}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="task-due-time">Due time</Label>
              <input
                id="task-due-time"
                type="time"
                value={value.dueTime}
                disabled={value.dueDate.length === 0}
                onChange={(event) => set('dueTime', event.target.value)}
                className={cn(FIELD, 'disabled:opacity-50')}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Priority</Label>
            <div className="flex flex-wrap gap-1">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  type="button"
                  onClick={() => set('priority', priority)}
                  aria-pressed={value.priority === priority}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px]',
                    'transition-colors duration-[var(--duration-fast)]',
                    value.priority === priority
                      ? 'border-accent bg-accent-soft text-ink'
                      : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                  )}
                >
                  {PRIORITY_LABELS[priority]}
                  {priority !== 'none' ? (
                    <Kbd className="hidden sm:inline-flex">{PRIORITY_KEYS[priority]}</Kbd>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="task-project">Project</Label>
              <select
                id="task-project"
                value={value.projectId ?? ''}
                onChange={(event) => set('projectId', event.target.value || null)}
                className={FIELD}
              >
                <option value="">Inbox — no project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="task-estimate">Estimate (minutes)</Label>
              <input
                id="task-estimate"
                type="number"
                min={0}
                step={5}
                inputMode="numeric"
                value={value.estimate}
                onChange={(event) => set('estimate', event.target.value)}
                placeholder="45"
                className={FIELD}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <TagPicker
              selected={value.tagIds}
              tags={tags}
              onChange={(tagIds) => set('tagIds', tagIds)}
              {...(onCreateTag ? { onCreate: onCreateTag } : {})}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Checklist</Label>
            {mode === 'edit' && subtasks && onAddSubtask ? (
              <SubtaskList
                subtasks={subtasks}
                onAdd={onAddSubtask}
                onToggle={onToggleSubtask ?? (() => undefined)}
                onDelete={onDeleteSubtask ?? (() => undefined)}
                onMove={onMoveSubtask ?? (() => undefined)}
              />
            ) : (
              <DraftSubtaskList
                titles={value.draftSubtasks}
                onChange={(titles) => set('draftSubtasks', titles)}
              />
            )}
          </div>
        </>
      ) : null}

      <div className="flex items-center gap-2 border-t border-line pt-3">
        <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
          {mode === 'create' ? 'Add task' : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>

        <div className="flex-1" />

        {mode === 'create' ? (
          <Button variant="ghost" size="sm" onClick={() => setShowMore((open) => !open)}>
            {showMore ? 'Fewer options' : 'More options'}
          </Button>
        ) : null}

        <span className="hidden items-center gap-1 text-[11.5px] text-ink-3 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
        </span>
      </div>
    </form>
  )
}
