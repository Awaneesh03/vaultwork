import { Inbox, Repeat, Timer, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/app/navigation'
import { formatEstimate } from '@/lib/date'
import type { TodayProgress } from '@/services'

/**
 * The evening's progress row: four warm cards, read at a glance.
 *
 * The daytime screen counts what is left — open, due, overdue. The evening
 * counts what today amounted to, so the same four facts are stated once, here,
 * and the page moves on to the work itself. Tasks carries a ring because a
 * fraction of a day's load is the one number worth seeing as a shape.
 *
 * Every value is already computed by the Today Engine. Nothing in this file
 * queries, derives or invents anything.
 */

/** The share of today's load that is done, as a closed ring. */
function ProgressRing({ done, planned }: { done: number; planned: number }) {
  const share = planned > 0 ? Math.min(1, done / planned) : 0
  const radius = 17
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
      <svg viewBox="0 0 40 40" className="h-9 w-9 -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={radius} fill="none" stroke="var(--line)" strokeWidth="3.5" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="var(--warn)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
        />
      </svg>
      <span className="tabular absolute text-micro font-semibold text-ink-2">
        {Math.round(share * 100)}%
      </span>
    </div>
  )
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[color-mix(in_oklab,var(--warn)_26%,var(--line))] text-[color-mix(in_oklab,var(--warn)_80%,var(--ink))]"
      style={{
        background:
          'linear-gradient(145deg, color-mix(in oklab, var(--warn) 22%, var(--surface)) 0%, var(--surface) 100%)',
      }}
    >
      <Icon size={15} aria-hidden />
    </div>
  )
}

function Card({
  label,
  value,
  href,
  describe,
  children,
}: {
  label: string
  value: string
  href: string
  describe: string
  children: React.ReactNode
}) {
  return (
    <Link
      to={href}
      aria-label={describe}
      className="group flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-elevated/40"
    >
      {children}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-meta text-ink-3">{label}</span>
        <span className="tabular truncate text-lg font-semibold tracking-tight text-ink">
          {value}
        </span>
      </div>
    </Link>
  )
}

export function EveningProgress({
  progress,
  capturesWaiting,
}: {
  progress: TodayProgress
  capturesWaiting: number
}) {
  const focus = progress.focusMinutes > 0 ? formatEstimate(progress.focusMinutes) : '0m'
  return (
    <section
      aria-label="Evening progress"
      className="grid grid-cols-2 divide-x divide-y divide-line/40 overflow-hidden rounded-xl border border-line/60 bg-surface/70 backdrop-blur-sm xl:grid-cols-4 xl:divide-y-0"
    >
      <Card
        label="Tasks"
        value={`${progress.tasksDone} / ${progress.tasksPlanned}`}
        href={ROUTES.completed}
        describe={`${progress.tasksDone} of ${progress.tasksPlanned} tasks done today. View completed`}
      >
        <ProgressRing done={progress.tasksDone} planned={progress.tasksPlanned} />
      </Card>

      <Card
        label="Focus time"
        value={focus}
        href={ROUTES.focus}
        describe={`${focus} focused today. View focus`}
      >
        <IconTile icon={Timer} />
      </Card>

      <Card
        label="Habits"
        value={`${progress.habitsDone} / ${progress.habitsScheduled}`}
        href={ROUTES.habits}
        describe={`${progress.habitsDone} of ${progress.habitsScheduled} habits logged today. View habits`}
      >
        <IconTile icon={Repeat} />
      </Card>

      <Card
        label="Captures"
        value={capturesWaiting > 0 ? `${capturesWaiting}` : 'Clear'}
        href={ROUTES.inbox}
        describe={
          capturesWaiting > 0 ? `${capturesWaiting} captures waiting. View inbox` : 'Inbox clear'
        }
      >
        <IconTile icon={Inbox} />
      </Card>
    </section>
  )
}
