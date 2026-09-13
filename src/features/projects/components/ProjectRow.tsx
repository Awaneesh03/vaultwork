import type { ReactNode } from 'react'
import { ArchiveRestore, Archive, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { formatDayLabel } from '@/lib/date'
import type { ProjectSummary } from '@/services'
import type { DateStr } from '@/types/entities'
import { PROJECT_STATUS_LABELS, projectColorVar, projectIcon } from '../projectAppearance'
import { ProjectProgress } from './ProjectProgress'

/**
 * One project.
 *
 * Purely presentational: rows and callbacks in, no state, no hook. Same
 * contract as `TaskRow`, for the same reasons — cheap in a list, testable
 * without a database.
 *
 * The information order is the question a person actually asks: *which
 * project → how much is left → is anything late → how far along is it.* Counts
 * come before the bar because a bar is a feeling and a number is a fact; the
 * overdue chip is the only thing allowed to use a warning colour, so it is the
 * one thing that catches the eye when it appears.
 */

export interface ProjectRowProps {
  summary: ProjectSummary
  today: DateStr
  selected?: boolean
  dragging?: boolean
  onOpen: () => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
  onSelect?: () => void
  /** The drag grip, supplied by the sortable wrapper. */
  handle?: ReactNode
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="tabular whitespace-nowrap">
      <span className="text-ink-2">{value}</span> <span className="text-ink-3">{label}</span>
    </span>
  )
}

/** "1 task", "4 tasks" — a count beside a plural noun it does not agree with
 *  is the kind of small wrongness that makes the rest look unchecked. */
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

export function ProjectRow({
  summary,
  today,
  selected = false,
  dragging = false,
  onOpen,
  onEdit,
  onArchive,
  onDelete,
  onSelect,
  handle,
}: ProjectRowProps) {
  const { project, stats } = summary
  const Icon = projectIcon(project.icon)
  const accent = projectColorVar(project.color)
  const archived = project.status === 'archived'

  return (
    <div
      data-project-id={project.id}
      data-selected={selected || undefined}
      onMouseDown={onSelect}
      className={cn(
        'group/row relative flex items-start gap-2.5 rounded-md border px-2 py-2 sm:px-2.5',
        'transition-colors duration-[var(--duration-fast)]',
        selected
          ? [
              'border-accent-line bg-accent-soft/60',
              // The same keyboard cursor the task rows carry, for the same
              // reason: these lists are walked with j/k and a tint alone is a
              // shade of grey to anyone not looking for it.
              'after:absolute after:inset-y-0 after:right-0 after:w-[2px]',
              'after:rounded-l-full after:bg-accent',
            ]
          : 'border-transparent hover:border-line hover:bg-surface',
        archived && 'opacity-70',
        dragging && 'opacity-40',
      )}
    >
      {handle}

      <span
        aria-hidden
        className="mt-[3px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)`, color: accent }}
      >
        <Icon size={13} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button
            type="button"
            onClick={onOpen}
            title={project.name}
            className="min-w-0 max-w-full truncate text-left text-strong font-medium leading-snug text-ink hover:text-accent"
          >
            {project.name}
          </button>

          {/* The shared Badge, so a project's state reads the same as a sync
              state or a document kind anywhere else in the application. */}
          <Badge tone={archived ? 'neutral' : 'confirm'}>
            {PROJECT_STATUS_LABELS[project.status]}
          </Badge>

          {stats.overdue > 0 ? (
            <Badge tone="danger" icon={<TriangleAlert size={10} />} className="tabular">
              {stats.overdue} overdue
            </Badge>
          ) : null}

          {project.deadline ? (
            <span className="tabular shrink-0 text-meta text-ink-3">
              {formatDayLabel(project.deadline, today)}
            </span>
          ) : null}
        </div>

        {project.description ? (
          <p className="mt-0.5 truncate text-body text-ink-3">{project.description}</p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
          {stats.total === 0 ? (
            <span className="text-meta text-ink-3">No tasks yet</span>
          ) : (
            <>
              <Stat value={stats.total} label={plural(stats.total, 'task', 'tasks')} />
              <Stat value={stats.completed} label="done" />
              <Stat value={stats.remaining} label="left" />
            </>
          )}

          <span className="flex min-w-[90px] flex-1 items-center gap-2">
            <ProjectProgress
              percent={stats.progress}
              label={`${stats.completed} of ${stats.total} tasks complete in ${project.name}`}
              accent={accent}
              className="min-w-[48px] flex-1"
            />
            <span className="tabular w-[34px] shrink-0 text-right text-meta text-ink-3">
              {stats.progress}%
            </span>
          </span>
        </div>
      </div>

      {/* Actions stay hidden until the row is hovered, focused or selected. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity',
          'focus-within:opacity-100 group-hover/row:opacity-100',
          selected && 'opacity-100',
        )}
      >
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${project.name}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-elevated hover:text-ink"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          onClick={onArchive}
          aria-label={archived ? `Restore ${project.name}` : `Archive ${project.name}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-elevated hover:text-ink"
        >
          {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${project.name}`}
          className="rounded-md p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
