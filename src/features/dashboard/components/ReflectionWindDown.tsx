import {
  ArrowUpRight,
  BookOpen,
  CheckCheck,
  Inbox,
  Moon,
  PenTool,
  Sparkles,
  Timer,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { ROUTES } from '@/app/navigation'
import { useUiStore } from '@/store/uiStore'
import type { RecentNote } from '@/services'

interface ReflectionWindDownProps {
  recentNotes: RecentNote[]
  completedCount: number
  capturesWaiting: number
}

/**
 * Reflection and Wind Down sections for the evening dashboard.
 *
 * Grounded 100% in existing Vaultwork capabilities:
 * - Reflection connects to existing Notes and Universal Capture
 * - Wind Down provides one-click navigation to wrap-up flows (completed work, tomorrow, inbox, focus)
 *
 * No fake journaling database, no dead buttons, no artificial interactions.
 */
export function ReflectionWindDown({
  recentNotes,
  completedCount,
  capturesWaiting,
}: ReflectionWindDownProps) {
  const navigate = useNavigate()
  const setCaptureOpen = useUiStore((s) => s.setCaptureOpen)

  return (
    <div className="flex flex-col gap-4">
      {/* Reflection Surface */}
      <section
        aria-label="Evening reflection"
        className="flex min-w-0 flex-col justify-between rounded-xl border border-line bg-surface/70 p-5 shadow-[var(--shadow-sm)] backdrop-blur-sm"
      >
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Sparkles size={13} aria-hidden />
            </div>
            <h3 className="text-body font-semibold tracking-tight text-ink">Evening Reflection</h3>
          </div>

          <p className="mt-2 text-meta leading-relaxed text-ink-3">
            Take a breath and capture any insights, ideas, or closing notes from today&apos;s work.
          </p>

          {recentNotes.length > 0 ? (
            <div className="mt-3.5 flex flex-col gap-1.5">
              <span className="text-micro font-medium uppercase tracking-wider text-ink-3">
                Today&apos;s captured notes
              </span>
              <ul className="flex flex-col gap-1">
                {recentNotes.slice(0, 2).map((note) => (
                  <li key={note.id}>
                    <Link
                      to={ROUTES.note(note.id)}
                      className="group flex items-center justify-between gap-2 rounded-md bg-sunken/60 px-2.5 py-1.5 text-body text-ink-2 transition-colors hover:bg-elevated hover:text-ink"
                    >
                      <span className="truncate">{note.title}</span>
                      <ArrowUpRight
                        size={11}
                        className="shrink-0 text-ink-3 group-hover:text-accent"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 pt-2 border-t border-line/40">
          <button
            type="button"
            onClick={() => setCaptureOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-line/60 bg-accent-soft px-3 py-1.5 text-meta font-medium text-accent transition-colors hover:bg-accent-soft/80"
          >
            <PenTool size={12} aria-hidden />
            Capture thought
          </button>
          <button
            type="button"
            onClick={() => navigate(ROUTES.notes)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-meta text-ink-2 transition-colors hover:border-accent-line hover:text-ink"
          >
            <BookOpen size={12} aria-hidden />
            Open notes
          </button>
        </div>
      </section>

      {/* Wind Down Surface */}
      <section
        aria-label="Wind down"
        className="flex min-w-0 flex-col justify-between rounded-xl border border-line bg-surface/70 p-5 shadow-[var(--shadow-sm)] backdrop-blur-sm"
      >
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Moon size={13} aria-hidden />
            </div>
            <h3 className="text-body font-semibold tracking-tight text-ink">Wind Down</h3>
          </div>

          <p className="mt-2 text-meta leading-relaxed text-ink-3">
            Review loose ends, celebrate today&apos;s output, and prepare your headspace for
            tomorrow.
          </p>

          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <Link
              to={ROUTES.completed}
              className="flex items-center gap-2 rounded-lg border border-line/50 bg-sunken/40 px-2.5 py-2 text-meta text-ink-2 transition-colors hover:border-accent-line hover:bg-elevated hover:text-ink"
            >
              <CheckCheck size={13} className="text-accent shrink-0" aria-hidden />
              <div className="min-w-0 truncate">
                <p className="font-medium truncate">Completed</p>
                <p className="text-micro text-ink-3">{completedCount} done today</p>
              </div>
            </Link>

            <Link
              to={ROUTES.upcoming}
              className="flex items-center gap-2 rounded-lg border border-line/50 bg-sunken/40 px-2.5 py-2 text-meta text-ink-2 transition-colors hover:border-accent-line hover:bg-elevated hover:text-ink"
            >
              <Moon size={13} className="text-ink-3 shrink-0" aria-hidden />
              <div className="min-w-0 truncate">
                <p className="font-medium truncate">Tomorrow</p>
                <p className="text-micro text-ink-3">Preview plan</p>
              </div>
            </Link>

            <Link
              to={ROUTES.focus}
              className="flex items-center gap-2 rounded-lg border border-line/50 bg-sunken/40 px-2.5 py-2 text-meta text-ink-2 transition-colors hover:border-accent-line hover:bg-elevated hover:text-ink"
            >
              <Timer size={13} className="text-ink-3 shrink-0" aria-hidden />
              <div className="min-w-0 truncate">
                <p className="font-medium truncate">Focus Log</p>
                <p className="text-micro text-ink-3">Daily stats</p>
              </div>
            </Link>

            <Link
              to={ROUTES.inbox}
              className="flex items-center gap-2 rounded-lg border border-line/50 bg-sunken/40 px-2.5 py-2 text-meta text-ink-2 transition-colors hover:border-accent-line hover:bg-elevated hover:text-ink"
            >
              <Inbox size={13} className="text-ink-3 shrink-0" aria-hidden />
              <div className="min-w-0 truncate">
                <p className="font-medium truncate">Inbox</p>
                <p className="text-micro text-ink-3">
                  {capturesWaiting > 0 ? `${capturesWaiting} waiting` : 'Clear'}
                </p>
              </div>
            </Link>
          </div>
        </div>

        <p className="mt-4 pt-2 border-t border-line/40 text-micro text-ink-3">
          Quiet command center ready for tomorrow.
        </p>
      </section>
    </div>
  )
}
