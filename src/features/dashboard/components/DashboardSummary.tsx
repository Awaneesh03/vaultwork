import { CheckCircle2, Clock, ListTodo, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/app/navigation'
import { cn } from '@/lib/cn'
import type { DashboardSummary as Summary } from '@/services'

/**
 * The four numbers worth knowing before anything else.
 *
 * Each tile is a real `<Link>`, not a card with a click handler: these are
 * navigations, so they belong in the tab order, open in a new tab on
 * middle-click, and announce themselves as links. Every destination is an
 * existing route taken from `ROUTES` — the Dashboard adds no screens of its own.
 *
 * "Due today" counts only what is due today; late work is the neighbouring
 * tile. Two tiles that quietly counted the same rows would make the pair add up
 * to more than the work that exists.
 */

interface Tile {
  key: keyof Summary
  label: string
  href: string
  icon: LucideIcon
  /** Turns the number red once it is non-zero. Only overdue earns this. */
  warn?: boolean
  /** Read out instead of the bare number, since "3" alone says nothing. */
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

export function DashboardSummary({ summary }: { summary: Summary }) {
  return (
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
              'group relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border',
              'bg-surface px-3.5 py-3 shadow-[var(--shadow-sm)]',
              'transition-colors duration-[var(--duration-fast)]',
              alarming
                ? 'border-danger/40 hover:border-danger'
                : 'border-line hover:border-accent-line hover:bg-elevated',
            )}
          >
            <span className="flex items-center gap-1.5 text-ink-3">
              <tile.icon size={12} aria-hidden />
              <span className="t-eyebrow truncate">{tile.label}</span>
            </span>
            <span aria-hidden className={cn('t-stat', alarming ? 'text-danger' : 'text-ink')}>
              {value}
            </span>
            {/*
              A hairline in the tile's own colour, at the foot of the card. It
              is the only decoration on these four, and it is what makes the
              alarming one legible at a glance without a red fill.
            */}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-0 bottom-0 h-[2px] transition-opacity duration-[var(--duration-base)]',
                alarming ? 'bg-danger opacity-100' : 'bg-accent opacity-0 group-hover:opacity-60',
              )}
            />
          </Link>
        )
      })}
    </div>
  )
}
