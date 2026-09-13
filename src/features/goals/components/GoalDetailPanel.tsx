import { useEffect, useRef } from 'react'
import {
  Archive,
  ArchiveRestore,
  Check,
  FolderKanban,
  Info,
  Pencil,
  Plus,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BacklinksPanel } from '@/features/notes/components/BacklinksPanel'
import { useBacklinks } from '@/features/notes/hooks/useNotes'
import { cn } from '@/lib/cn'
import { formatFullDate } from '@/lib/date'
import { useNoteUiStore } from '@/store/noteUiStore'
import type { GoalDetailData } from '@/services'
import type { Id } from '@/types/entities'
import {
  GOAL_HEALTH_CLASSES,
  GOAL_HEALTH_LABELS,
  GOAL_HORIZON_LABELS,
  GOAL_STATUS_LABELS,
  describeBasis,
} from '../goalAppearance'
import { GoalProgress } from './GoalProgress'
import { MilestoneList } from './MilestoneList'

/**
 * One goal's full picture.
 *
 * A side panel rather than a new modal framework — the same shape and the same
 * dismissal rules as `TaskDetailPanel` and `HabitDetailPanel`, so there is one
 * "open a thing" pattern in the application rather than five.
 *
 * The panel is arranged around the distinction the whole feature rests on:
 * the **outcome** at the top, the **checkpoints** in the middle, and the
 * **actions** at the bottom — with a line saying in words which of the two
 * lower sections the percentage was computed from.
 */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-surface px-2.5 py-1.5">
      <span className="t-eyebrow text-ink-3">
        {label}
      </span>
      <span className="tabular text-[15px] font-semibold leading-tight text-ink">{value}</span>
      {hint ? <span className="text-[10.5px] text-ink-3">{hint}</span> : null}
    </div>
  )
}

export function GoalDetailPanel({
  detail,
  busy = false,
  onClose,
  onComplete,
  onEdit,
  onArchive,
  onDelete,
  onAddMilestone,
  onToggleMilestone,
  onEditMilestone,
  onDeleteMilestone,
  onMoveMilestone,
}: {
  detail: GoalDetailData
  busy?: boolean
  onClose: () => void
  onComplete: () => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
  onAddMilestone: () => void
  onToggleMilestone: (id: Id) => void
  onEditMilestone: (id: Id) => void
  onDeleteMilestone: (id: Id) => void
  onMoveMilestone: (orderedIds: Id[], fromIndex: number, toIndex: number) => void
}) {
  const { goal, progress, milestones, tasks, health, milestoneViews } = detail
  const panel = useRef<HTMLElement>(null)
  const backlinks = useBacklinks('goal', goal.id)
  const openNoteComposer = useNoteUiStore((s) => s.openComposer)

  // A modal takes focus when it opens. Without this, Escape does nothing until
  // the user has tabbed inside, which is not how a dialog is meant to behave.
  useEffect(() => {
    panel.current?.focus()
  }, [])

  const completed = goal.status === 'achieved'
  const archived = goal.status === 'dropped'
  // From the query service, which got it from the clock port. A component must
  // never read the wall clock: it would ignore a frozen clock in tests and use
  // UTC rather than the local day.
  const today = detail.today

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${goal.title} details`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        className="flex h-full w-full max-w-lg flex-col border-l border-line bg-elevated shadow-xl [animation:panel-in_var(--duration-base)_var(--ease-out)]"
      >
        <header className="flex items-start gap-2 border-b border-line px-4 py-3">
          <Target size={16} className="mt-[3px] shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-snug tracking-tight text-ink">
              {goal.title}
            </h2>
            <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-3">
              <span
                className={cn('rounded-sm px-1.5 py-px text-[10.5px]', GOAL_HEALTH_CLASSES[health])}
              >
                {GOAL_HEALTH_LABELS[health]}
              </span>
              <span>{GOAL_HORIZON_LABELS[goal.horizon]}</span>
              {goal.status !== 'active' ? <span>{GOAL_STATUS_LABELS[goal.status]}</span> : null}
              {goal.targetDate ? <span>by {formatFullDate(goal.targetDate)}</span> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 hover:bg-surface hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {goal.why ? (
            <p className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
              {goal.why}
            </p>
          ) : null}

          <section className="flex flex-col gap-2">
            <GoalProgress
              label={`${goal.title} progress`}
              progress={progress}
              tone={completed || archived ? 'muted' : 'accent'}
            />
            <p className="text-[11.5px] text-ink-3">
              <span className="tabular text-ink-2">{progress.percent}%</span> — measured from{' '}
              {describeBasis(milestones.total, tasks.total)}
              {milestones.total > 0 && tasks.total > 0
                ? '. Tasks are shown below but do not set this figure.'
                : ''}
            </p>
          </section>

          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="Milestones"
              value={`${milestones.done}/${milestones.total}`}
              hint="checkpoints met"
            />
            <Stat label="Tasks" value={`${tasks.done}/${tasks.total}`} hint="related work" />
            <Stat
              label="Unfiled"
              value={String(detail.unassignedTasks.length)}
              hint="no checkpoint"
            />
          </div>

          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="flex-1 t-eyebrow text-ink-3">
                Milestones
              </h3>
              <Button
                variant="secondary"
                size="sm"
                onClick={onAddMilestone}
                icon={<Plus size={11} aria-hidden />}
              >
                Add
              </Button>
            </div>

            {milestoneViews.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-3 py-3 text-[12.5px] text-ink-3">
                No checkpoints yet. Until there are, this goal&rsquo;s progress is measured from
                its related tasks.
              </p>
            ) : (
              <MilestoneList
                views={milestoneViews}
                today={today}
                onToggle={onToggleMilestone}
                onEdit={onEditMilestone}
                onDelete={onDeleteMilestone}
                onMove={onMoveMilestone}
              />
            )}
          </section>

          {detail.projects.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="t-eyebrow text-ink-3">
                Projects
              </h3>
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {detail.projects.map((project) => (
                  <li
                    key={project.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-ink-2"
                  >
                    <FolderKanban size={12} className="shrink-0 text-ink-3" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {project.status.replace('_', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.unassignedTasks.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="t-eyebrow text-ink-3">
                Work with no checkpoint
              </h3>
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {detail.unassignedTasks.slice(0, 8).map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]"
                  >
                    <Check
                      size={12}
                      className={cn(
                        'shrink-0',
                        task.status === 'done' ? 'text-ok' : 'text-ink-3 opacity-30',
                      )}
                      aria-label={task.status === 'done' ? 'complete' : 'open'}
                    />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        task.status === 'done' ? 'text-ink-3 line-through' : 'text-ink-2',
                      )}
                    >
                      {task.title}
                    </span>
                  </li>
                ))}
              </ul>
              {detail.unassignedTasks.length > 8 ? (
                <p className="text-[11px] text-ink-3">
                  and {detail.unassignedTasks.length - 8} more.
                </p>
              ) : null}
            </section>
          ) : null}

          <BacklinksPanel
            backlinks={backlinks}
            onCreate={() => openNoteComposer({ refType: 'goal', refId: goal.id })}
          />

          <p className="inline-flex items-start gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-3">
            <Info size={11} className="mt-[2px] shrink-0" aria-hidden />
            Completing or deleting this goal never completes or deletes a task. A goal is an
            outcome; the tasks are work that still has to be done.
          </p>
        </div>

        <footer className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-3">
          <Button
            variant={completed ? 'secondary' : 'primary'}
            size="sm"
            disabled={busy}
            onClick={onComplete}
            icon={<Check size={12} aria-hidden />}
          >
            {completed ? 'Reopen' : 'Complete'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onEdit}
            icon={<Pencil size={12} aria-hidden />}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onArchive}
            icon={
              archived ? <ArchiveRestore size={12} aria-hidden /> : <Archive size={12} aria-hidden />
            }
          >
            {archived ? 'Restore' : 'Archive'}
          </Button>
          <span className="flex-1" />
          <Button
            variant="danger"
            size="sm"
            onClick={onDelete}
            icon={<Trash2 size={12} aria-hidden />}
          >
            Delete
          </Button>
        </footer>
      </aside>
    </div>
  )
}
