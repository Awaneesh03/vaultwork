import { CheckCircle2, Clock, Folder } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/app/navigation'
import { CountBadge } from '@/components/ui/Badge'
import { formatEstimate } from '@/lib/date'
import type { Project, Task } from '@/types/entities'

interface CompletedTodayProps {
  tasks: Task[]
  projects: Project[]
  onOpen: (task: Task) => void
}

/**
 * Completed Today — the primary evening retrospective section.
 *
 * In an evening command center, acknowledging completed work is central to
 * winding down with confidence. These rows are lightweight, calm, and readable.
 * Clicking a row opens the existing TaskDetailPanel.
 */
export function CompletedToday({ tasks, projects, onOpen }: CompletedTodayProps) {
  const projectMap = new Map(projects.map((p) => [p.id, p.name]))

  return (
    <section
      aria-label="Completed today"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface/80 p-5 shadow-[var(--shadow-sm)] backdrop-blur-sm transition-colors duration-[var(--duration-base)]"
    >
      <header className="flex items-center justify-between pb-3 border-b border-line/60">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent">
            <CheckCircle2 size={14} aria-hidden />
          </div>
          <h3 className="text-body font-semibold tracking-tight text-ink">Completed Today</h3>
          <CountBadge value={tasks.length} tone="neutral" />
        </div>

        <Link
          to={ROUTES.completed}
          className="text-meta text-ink-3 transition-colors hover:text-accent"
        >
          View all
        </Link>
      </header>

      {tasks.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-body text-ink-3">No tasks completed today.</p>
          <p className="mt-1 text-meta text-ink-3/70">
            Work completed today will gather here as you wrap up your evening.
          </p>
        </div>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-line/40">
          {tasks.map((task) => {
            const projectName = task.projectId ? projectMap.get(task.projectId) : null

            return (
              <li key={task.id} className="group flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <CheckCircle2 size={12} strokeWidth={2.5} aria-hidden />
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpen(task)}
                    title={task.title}
                    className="truncate text-left text-body text-ink-2 line-through decoration-ink-3/40 transition-colors group-hover:text-ink group-hover:decoration-ink-3"
                  >
                    {task.title}
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-2 text-meta text-ink-3">
                  {projectName ? (
                    <span className="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-0.5 text-micro text-ink-2">
                      <Folder size={10} aria-hidden />
                      <span className="max-w-[120px] truncate">{projectName}</span>
                    </span>
                  ) : null}

                  {task.estimateMin !== null ? (
                    <span className="tabular inline-flex items-center gap-1 font-mono text-micro text-ink-3">
                      <Clock size={10} aria-hidden />
                      {formatEstimate(task.estimateMin)}
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
