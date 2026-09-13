import type { ReactNode } from 'react'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CountBadge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'

/**
 * The shell every Dashboard section shares.
 *
 * Six sections that each invented their own heading, count badge, "view all"
 * link and empty state would be six places for the hierarchy to drift. One
 * shell means the Dashboard reads as a single surface rather than as a pile of
 * unrelated cards — which is the difference between a command centre and a
 * widget board.
 *
 * The empty state is a property of the card, not of each caller, so no section
 * can quietly forget one and render a blank rectangle.
 */

export interface DashboardCardProps {
  title: string
  icon: LucideIcon
  /** Shown beside the title when there is something to count. */
  count?: number | undefined
  /** Where "view all" goes. Omitted for sections with no full screen. */
  href?: string | undefined
  linkLabel?: string | undefined
  /** Rendered instead of the children when true. */
  isEmpty?: boolean
  /** One compact line. Not an illustration, not a call to arms. */
  empty?: ReactNode
  /** Draws the title in the warning colour — used only by Overdue. */
  tone?: 'plain' | 'warn'
  className?: string
  children: ReactNode
}

export function DashboardCard({
  title,
  icon: Icon,
  count,
  href,
  linkLabel,
  isEmpty = false,
  empty,
  tone = 'plain',
  className,
  children,
}: DashboardCardProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border bg-surface',
        'shadow-[var(--shadow-sm)] transition-colors duration-[var(--duration-base)]',
        // Overdue is the only card allowed to announce itself, and it does so
        // with an edge rather than a fill: a red panel would out-shout the
        // tasks printed on it.
        tone === 'warn' ? 'border-danger/35' : 'border-line',
        className,
      )}
    >
      <header
        className={cn(
          'flex items-center gap-2 border-b px-3.5 py-2.5',
          tone === 'warn' ? 'border-danger/25 bg-danger-soft/30' : 'border-line',
        )}
      >
        <Icon
          size={13}
          className={tone === 'warn' ? 'text-danger' : 'text-ink-3'}
          aria-hidden
        />
        {/*
          A real title rather than an eyebrow. These name the sections a person
          navigates by, and letter-spaced small caps are harder to scan than the
          words themselves.
        */}
        <h3
          className={cn(
            'text-[12.5px] font-semibold tracking-tight',
            tone === 'warn' ? 'text-danger' : 'text-ink-2',
          )}
        >
          {title}
        </h3>
        <CountBadge value={count ?? 0} tone={tone === 'warn' ? 'danger' : 'neutral'} />

        <span className="flex-1" />

        {href ? (
          <Link
            to={href}
            className="group/link inline-flex items-center gap-1 rounded-sm text-[11.5px] text-ink-3 transition-colors hover:text-accent"
          >
            {linkLabel ?? 'View all'}
            <ArrowRight
              size={11}
              aria-hidden
              className="transition-transform duration-[var(--duration-fast)] group-hover/link:translate-x-0.5"
            />
          </Link>
        ) : null}
      </header>

      {isEmpty ? (
        <p className="px-3.5 py-3.5 text-[12.5px] text-ink-3">{empty ?? 'Nothing here.'}</p>
      ) : (
        children
      )}
    </section>
  )
}
