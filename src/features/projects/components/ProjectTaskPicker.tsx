import { useMemo, useRef, useState } from 'react'
import { Minus, Plus, Search, X } from 'lucide-react'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import { formatDayLabel } from '@/lib/date'
import type { DateStr, Id, Project, Task } from '@/types/entities'

/**
 * Moving existing tasks in and out of a project.
 *
 * Both directions live in one panel because they are one decision — "which of
 * my tasks belong to College?" — and answering half of it in a different place
 * makes you open two things to do one job.
 *
 * Neither button is a special kind of write: adding sets `task.projectId` and
 * removing sets it to `null`, which is the same `task.assignProject` intent in
 * both directions. Removing a task from a project therefore *cannot* delete it;
 * there is no code path here that could.
 */

export interface ProjectTaskPickerProps {
  project: Project
  today: DateStr
  /** Tasks currently filed under this project. */
  members: Task[]
  /** Open tasks filed elsewhere, or nowhere. */
  candidates: Task[]
  busy?: boolean
  onAssign: (taskId: Id, projectId: Id | null) => void
  onClose: () => void
}

function matches(task: Task, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const text = `${task.title} ${task.description ?? ''}`.toLowerCase()
  return terms.every((term) => text.includes(term))
}

function TaskLine({
  task,
  today,
  action,
  label,
  icon,
  onClick,
}: {
  task: Task
  today: DateStr
  action: 'add' | 'remove'
  label: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface">
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-strong',
            task.status === 'done' ? 'text-ink-3 line-through' : 'text-ink',
          )}
        >
          {task.title}
        </span>
        {task.dueDate ? (
          <span className="tabular text-meta text-ink-3">
            {formatDayLabel(task.dueDate, today)}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className={cn(
          'shrink-0 rounded-md border p-1 transition-colors',
          action === 'add'
            ? 'border-line text-ink-3 hover:border-accent hover:bg-accent-soft hover:text-ink'
            : 'border-line text-ink-3 hover:border-danger hover:bg-danger-soft hover:text-danger',
        )}
      >
        {icon}
      </button>
    </li>
  )
}

export function ProjectTaskPicker({
  project,
  today,
  members,
  candidates,
  busy = false,
  onAssign,
  onClose,
}: ProjectTaskPickerProps) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const shownMembers = useMemo(
    () => members.filter((task) => matches(task, query)),
    [members, query],
  )
  const shownCandidates = useMemo(
    () => candidates.filter((task) => matches(task, query)).slice(0, 40),
    [candidates, query],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-[8vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Manage tasks in ${project.name}`}
        className="w-full max-w-lg rounded-lg border border-line bg-elevated shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="flex-1 text-strong font-semibold tracking-tight text-ink">
            Tasks in {project.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 hover:bg-surface hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="border-b border-line px-4 py-2.5">
          <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-accent-line">
            <Search size={13} className="shrink-0 text-ink-3" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks to assign"
              className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-3"
            />
          </div>
        </div>

        <div className="max-h-[46vh] overflow-y-auto p-2" aria-busy={busy}>
          <section className="mb-3">
            <h3 className="px-2 pb-1 t-eyebrow text-ink-3">
              In this project · {shownMembers.length}
            </h3>
            {shownMembers.length === 0 ? (
              <p className="px-2 py-1 text-body text-ink-3">Nothing filed here yet.</p>
            ) : (
              <ul>
                {shownMembers.map((task) => (
                  <TaskLine
                    key={task.id}
                    task={task}
                    today={today}
                    action="remove"
                    label={`Remove ${task.title} from ${project.name}`}
                    icon={<Minus size={13} aria-hidden />}
                    onClick={() => onAssign(task.id, null)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="px-2 pb-1 t-eyebrow text-ink-3">
              Other open tasks · {shownCandidates.length}
            </h3>
            {shownCandidates.length === 0 ? (
              <p className="px-2 py-1 text-body text-ink-3">
                {query.length > 0 ? 'Nothing matches that.' : 'Every open task is already here.'}
              </p>
            ) : (
              <ul>
                {shownCandidates.map((task) => (
                  <TaskLine
                    key={task.id}
                    task={task}
                    today={today}
                    action="add"
                    label={`Add ${task.title} to ${project.name}`}
                    icon={<Plus size={13} aria-hidden />}
                    onClick={() => onAssign(task.id, project.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-2 text-meta text-ink-3">
          <Kbd>esc</Kbd>
          <span>to close. Removing a task keeps it — it moves to the Inbox.</span>
        </footer>
      </div>
    </div>
  )
}
