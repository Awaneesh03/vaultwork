import {
  CheckCircle2,
  Clock,
  Flame,
  ListTodo,
  Timer,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/app/navigation'
import { cn } from '@/lib/cn'
import { formatEstimate } from '@/lib/date'
import type { DashboardSummary as Summary, TodayProgress } from '@/services'

/**
 * Compact Progress Row / Summary Tiles.
 *
 * Each tile is a real <Link> matching the exact aria-label and destination contracts
 * required by the application and its test suite.
 *
 * Visually redesigned into a compact, restrained evening progress strip:
 * avoiding "card soup" and giant boxes while highlighting today's key numbers.
 */

interface Tile {
  key: keyof Summary
  label: string
  href: string
  icon: LucideIcon
  warn?: boolean
  describe: (value: number) => string
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

const TILES: Tile[] = [
  {
    key: 'open',
    label: 'Open',
    href: ROUTES.allTasks,
    icon: ListTodo,
    describe: (n) => `${n} open ${plural(n, 'task', 'tasks')}. View all tasks`,
  },
  {
    key: 'dueToday',
    label: 'Due today',
    href: ROUTES.today,
    icon: Clock,
    describe: (n) => `${n} ${plural(n, 'task', 'tasks')} due today. View today`,
  },
  {
    key: 'overdue',
    label: 'Overdue',
    href: ROUTES.overdue,
    icon: TriangleAlert,
    warn: true,
    describe: (n) => `${n} overdue ${plural(n, 'task', 'tasks')}. View overdue`,
  },
  {
    key: 'completedToday',
    label: 'Done today',
    href: ROUTES.completed,
    icon: CheckCircle2,
    describe: (n) => `${n} ${plural(n, 'task', 'tasks')} completed today. View completed`,
  },
]

export function DashboardSummary({
  summary,
  progress,
}: {
  summary: Summary
  progress?: TodayProgress | undefined
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TILES.map((tile) => {
          const value = summary[tile.key]
          const alarming = tile.warn === true && value > 0

          return (
            <Link
              key={tile.key}
              to={tile.href}
              aria-label={tile.describe(value)}
              className={cn(
                'group relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-xl border',
                'bg-surface/80 px-3.5 py-2.5 shadow-[var(--shadow-sm)] backdrop-blur-sm',
                'transition-all duration-[var(--duration-fast)]',
                alarming
                  ? 'border-danger/40 hover:border-danger hover:bg-danger-soft/20'
                  : 'border-line/70 hover:border-accent-line/60 hover:bg-elevated/70',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-ink-3">
                  <tile.icon
                    size={13}
                    aria-hidden
                    className={alarming ? 'text-danger' : 'text-ink-3'}
                  />
                  <span className="text-micro font-medium uppercase tracking-wider text-ink-3 truncate">
                    {tile.label}
                  </span>
                </span>
              </div>

              <span
                aria-hidden
                className={cn(
                  'tabular text-xl sm:text-2xl font-semibold',
                  alarming ? 'text-danger' : 'text-ink',
                )}
              >
                {value}
              </span>

              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-0 bottom-0 h-[2px] transition-opacity duration-[var(--duration-base)]',
                  alarming ? 'bg-danger opacity-100' : 'bg-accent opacity-0 group-hover:opacity-70',
                )}
              />
            </Link>
          )
        })}
      </div>

      {/* Optional compact evening progress ribbon for Focus and Habits */}
      {progress && (progress.focusMinutes > 0 || progress.habitsScheduled > 0) ? (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line/40 bg-surface/50 px-3.5 py-1.5 text-meta text-ink-3 backdrop-blur-sm">
          {progress.focusMinutes > 0 ? (
            <div className="flex items-center gap-1.5">
              <Timer size={12} className="text-accent" aria-hidden />
              <span>
                Focus:{' '}
                <strong className="font-medium text-ink">
                  {formatEstimate(progress.focusMinutes)}
                </strong>
              </span>
            </div>
          ) : null}

          {progress.habitsScheduled > 0 ? (
            <div className="flex items-center gap-1.5">
              <Flame size={12} className="text-warn" aria-hidden />
              <span>
                Habits:{' '}
                <strong className="font-medium text-ink">
                  {progress.habitsDone} / {progress.habitsScheduled}
                </strong>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
