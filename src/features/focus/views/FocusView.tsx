import { useEffect, useState } from 'react'
import { Ban, Check, Coffee, Timer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SectionHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/cn'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import type { FocusSession } from '@/types/entities'
import type { FocusKind } from '@/types/enums'
import { useFocus } from '../hooks/useFocus'

/**
 * The Pomodoro screen.
 *
 * The countdown is arithmetic on the session's own timestamps, so what this
 * renders is always what the database says — a reload mid-session shows the
 * same number, and a machine that slept does not come back with imaginary
 * focus time.
 *
 * Deliberately plain: one big number, one primary action, and the history
 * underneath. A focus timer competing for attention with the work it is meant
 * to protect would be a strange thing to build.
 */

const KINDS: { value: FocusKind; label: string; icon: typeof Timer }[] = [
  { value: 'work', label: 'Focus', icon: Timer },
  { value: 'short_break', label: 'Short break', icon: Coffee },
  { value: 'long_break', label: 'Long break', icon: Coffee },
]

const KIND_LABEL: Record<FocusKind, string> = {
  work: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break',
}

/** "25:00" — the only place milliseconds become something to read. */
function clock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function HistoryRow({ session }: { session: FocusSession }) {
  const aborted = session.outcome === 'aborted'
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      {aborted ? (
        <Ban size={13} className="shrink-0 text-ink-3" aria-hidden />
      ) : (
        <Check size={13} className="shrink-0 text-ok" aria-hidden />
      )}
      <span className="flex-1 text-strong text-ink">{KIND_LABEL[session.kind]}</span>
      <span className="tabular font-mono text-body text-ink-3">
        {session.actualMin}m
        {session.actualMin !== session.plannedMin ? ` of ${session.plannedMin}m` : ''}
      </span>
      <span className="text-meta text-ink-3">{aborted ? 'stopped' : 'finished'}</span>
    </li>
  )
}

export function FocusView() {
  const focus = useFocus()
  const [planned, setPlanned] = useState<Record<FocusKind, number> | null>(null)

  // The durations come from the user's own Pomodoro settings, read once so the
  // buttons can say how long each session will be before it starts.
  const plannedFor = focus.plannedFor
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [work, shortBreak, longBreak] = await Promise.all([
        plannedFor('work'),
        plannedFor('short_break'),
        plannedFor('long_break'),
      ])
      if (!cancelled) {
        setPlanned({ work, short_break: shortBreak, long_break: longBreak })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [plannedFor])

  const active = focus.active
  const running = active ?? null

  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-7 transition-[max-width] duration-[var(--duration-slow)]',
        // A running session narrows the column and drops the explanatory
        // chrome. The screen you use to stop being distracted should not be
        // the busiest one in the application.
        running ? 'max-w-lg' : 'max-w-2xl',
      )}
    >
      {running === null ? (
        <header className="flex flex-col gap-1">
          <h2 className="t-page flex items-center gap-2">
            <Timer size={16} className="text-ink-3" aria-hidden />
            Focus
          </h2>
          <p className="t-meta max-w-prose text-ink-3">
            Sessions are stored as timestamps, not ticks — reload mid-session and the countdown is
            still right.
          </p>
        </header>
      ) : null}

      <section
        className={cn(
          'relative flex flex-col items-center gap-5 overflow-hidden rounded-xl border p-9',
          'transition-colors duration-[var(--duration-slow)]',
          running
            ? 'border-accent-line/50 bg-surface shadow-[var(--shadow-lg)]'
            : 'border-line bg-surface shadow-[var(--shadow-sm)]',
        )}
        aria-label="Timer"
      >
        {/*
          A single soft violet wash behind a running clock, and nothing at all
          when idle. It is the only ambient treatment in the application, which
          is what lets it mean "a session is running" rather than just "this is
          a card".
        */}
        {running ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-[radial-gradient(ellipse_at_center,var(--accent-soft),transparent_70%)] opacity-70"
          />
        ) : null}
        {running === null ? (
          <>
            <p className="tabular font-mono text-[52px] leading-none font-light tracking-tight text-ink-3/60">
              {planned === null ? '--:--' : clock(planned.work * 60_000)}
            </p>
            <p className="t-meta text-ink-3">Nothing running.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {KINDS.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  size="sm"
                  variant={value === 'work' ? 'primary' : 'secondary'}
                  icon={<Icon size={13} aria-hidden />}
                  disabled={focus.busy || active === undefined}
                  onClick={() => void focus.start({ kind: value })}
                >
                  {label}
                  {planned ? ` · ${planned[value]}m` : ''}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p
              className={cn(
                'tabular relative font-mono text-[68px] leading-none font-light tracking-tight',
                focus.overrun ? 'text-accent-2' : 'text-ink',
              )}
              role="timer"
              aria-live="off"
            >
              {clock(focus.remaining ?? 0)}
            </p>
            <p className="t-meta relative text-ink-2">
              {KIND_LABEL[running.kind]} · {running.plannedMin}m
              {focus.overrun ? ' · finishing…' : ''}
            </p>
            <div className="relative flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                variant="confirm"
                icon={<Check size={13} aria-hidden />}
                disabled={focus.busy}
                onClick={() => void focus.complete()}
              >
                Finish now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Ban size={13} aria-hidden />}
                disabled={focus.busy}
                onClick={() => void focus.cancel()}
              >
                Stop
              </Button>
            </div>
            <p className="relative text-meta text-ink-3">
              Stopping still records the time you spent.
            </p>
          </>
        )}

        {focus.error ? (
          <p role="status" className="text-body text-danger">
            {focus.error}
          </p>
        ) : null}
      </section>

      {/*
        The history is context, and context is exactly what a running session
        does not need. It comes back the moment the clock stops.
      */}
      <section
        className={cn('flex flex-col gap-3', running ? 'hidden' : 'flex')}
        aria-label="Recent sessions"
      >
        <SectionHeader label="Recent sessions" />
        <DataView
          data={focus.history}
          isEmpty={(sessions) => sessions.length === 0}
          empty={
            <EmptyState
              title="No sessions yet"
              description="Finished and stopped sessions both appear here, with the time actually spent."
            />
          }
        >
          {(sessions) => (
            <ul className="divide-y divide-line panel">
              {sessions.map((session) => (
                <HistoryRow key={session.id} session={session} />
              ))}
            </ul>
          )}
        </DataView>
      </section>
    </div>
  )
}
