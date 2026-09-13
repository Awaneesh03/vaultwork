import { useEffect, useRef } from 'react'
import { Archive, ArchiveRestore, Check, Flame, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BacklinksPanel } from '@/features/notes/components/BacklinksPanel'
import { useBacklinks } from '@/features/notes/hooks/useNotes'
import { cn } from '@/lib/cn'
import { formatFullDate } from '@/lib/date'
import { useNoteUiStore } from '@/store/noteUiStore'
import { projectColorVar } from '@/features/projects/projectAppearance'
import type { HabitDetailData } from '@/services'
import { HABIT_FREQUENCY_LABELS, describeDays } from '../habitAppearance'
import { HabitHistoryStrip } from './HabitHistoryStrip'

/**
 * One habit's full picture.
 *
 * A side panel rather than a new modal framework — the same shape and the same
 * dismissal rules as `TaskDetailPanel`, so there is one "open a thing" pattern
 * in the application rather than four.
 *
 * Every number shown here is computed by the shared stat functions, so the
 * panel cannot disagree with the row that opened it.
 */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-surface px-2.5 py-1.5">
      <span className="t-eyebrow text-ink-3">{label}</span>
      <span className="tabular text-title font-semibold leading-tight text-ink">{value}</span>
      {hint ? <span className="text-micro text-ink-3">{hint}</span> : null}
    </div>
  )
}

export function HabitDetailPanel({
  detail,
  busy = false,
  onClose,
  onToggle,
  onEdit,
  onArchive,
  onDelete,
}: {
  detail: HabitDetailData
  busy?: boolean
  onClose: () => void
  onToggle: () => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const { habit } = detail
  const panel = useRef<HTMLElement>(null)
  const backlinks = useBacklinks('habit', habit.id)
  const openNoteComposer = useNoteUiStore((s) => s.openComposer)

  // A modal takes focus when it opens. Without this, Escape does nothing until
  // the user has tabbed inside, which is not how a dialog is meant to behave.
  useEffect(() => {
    panel.current?.focus()
  }, [])

  const accent = projectColorVar(habit.color)
  const archived = habit.archivedAt !== null

  const schedule =
    detail.frequency === 'weekly'
      ? `${habit.targetPerWeek ?? 1}× per week`
      : detail.frequency === 'custom'
        ? describeDays(habit.daysOfWeek)
        : HABIT_FREQUENCY_LABELS[detail.frequency]

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
        aria-label={`${habit.name} details`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-elevated shadow-xl [animation:panel-in_var(--duration-base)_var(--ease-out)]"
      >
        <header className="flex items-start gap-2 border-b border-line px-4 py-3">
          <span
            aria-hidden
            className="mt-[3px] h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title font-semibold tracking-tight text-ink">
              {habit.name}
            </h2>
            <p className="text-meta text-ink-3">
              {schedule}
              {archived ? ' · Archived' : ''}
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
          <div>
            <Button
              variant={detail.completedToday ? 'secondary' : 'primary'}
              size="sm"
              disabled={busy || !detail.scheduledToday}
              onClick={onToggle}
              icon={<Check size={12} aria-hidden />}
            >
              {!detail.scheduledToday
                ? 'Not scheduled today'
                : detail.completedToday
                  ? 'Undo today'
                  : 'Complete today'}
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label="Streak" value={String(detail.currentStreak)} hint="current" />
            <Stat label="Best" value={String(detail.longestStreak)} hint="longest" />
            <Stat
              label="Rate"
              value={`${detail.rate.percent}%`}
              hint={`${detail.rate.completed}/${detail.rate.scheduled} ${
                detail.rate.scheduled === 1 ? 'day' : 'days'
              }`}
            />
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="t-eyebrow text-ink-3">Last {detail.history.length} days</h3>
            <HabitHistoryStrip name={habit.name} days={detail.history} />

            {/* A legend, because the squares alone are not self-describing. */}
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-3">
              <li className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-[2px] border border-accent bg-accent" />
                Completed
              </li>
              <li className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-[2px] border border-line-strong" />
                Missed
              </li>
              <li className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-sunken" />
                Not scheduled
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-1.5">
            <h3 className="t-eyebrow text-ink-3">Recent completions</h3>
            {detail.entries.length === 0 ? (
              <p className="text-body text-ink-3">Nothing recorded yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {[...detail.entries]
                  .reverse()
                  .slice(0, 10)
                  .map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-baseline gap-2 px-2.5 py-1.5 text-body"
                    >
                      <span className="flex-1 text-ink-2">{formatFullDate(entry.date)}</span>
                      {habit.kind === 'quantity' ? (
                        <span className="tabular text-ink-3">
                          {entry.value}
                          {habit.unit ? ` ${habit.unit}` : ''}
                        </span>
                      ) : (
                        <Check size={12} className="text-ok" aria-label="completed" />
                      )}
                    </li>
                  ))}
              </ul>
            )}
            <p className="text-micro text-ink-3">
              {detail.totalEntries} recorded {detail.totalEntries === 1 ? 'day' : 'days'} in total.
            </p>
          </section>

          <BacklinksPanel
            backlinks={backlinks}
            onCreate={() => openNoteComposer({ refType: 'habit', refId: habit.id })}
          />

          <p
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-meta text-ink-3',
            )}
          >
            <Flame size={11} aria-hidden />
            Days this habit is not scheduled never count against a streak.
          </p>
        </div>

        <footer className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-3">
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
              archived ? (
                <ArchiveRestore size={12} aria-hidden />
              ) : (
                <Archive size={12} aria-hidden />
              )
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
