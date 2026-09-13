import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The panel every surface in the application is made of.
 *
 * Three tones, and the reason there are exactly three is that a card's job is
 * to say how much attention it wants — not to be decorated:
 *
 *   plain     the default. A quiet container.
 *   raised    a popover or dialog: one surface step up, a real shadow.
 *   accent    something that wants to be read first. A tinted edge, never a
 *             tinted fill — a filled violet card on a dark canvas shouts over
 *             every word inside it.
 *
 * There is deliberately no `gradient` and no `glow`. If everything glows, the
 * glow has stopped meaning anything.
 */

export type CardTone = 'plain' | 'raised' | 'accent'

const TONES: Record<CardTone, string> = {
  plain: 'bg-surface border-line shadow-[var(--shadow-sm)]',
  raised: 'bg-elevated border-line shadow-[var(--shadow-lg)]',
  accent: 'bg-surface border-accent-line/60 shadow-[var(--shadow-sm)]',
}

export function Card({
  tone = 'plain',
  className,
  children,
  ...rest
}: {
  tone?: CardTone
  className?: string
  children: ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  return (
    <div className={cn('rounded-lg border', TONES[tone], className)} {...rest}>
      {children}
    </div>
  )
}

/**
 * A card's header row: a title, optional supporting line, optional actions.
 *
 * Exists so that the gap between a title and its content is the same on every
 * screen. Spacing consistency is most of what "designed" means from across the
 * room.
 */
export function CardHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-3 gap-y-2', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {icon ? <span className="shrink-0 text-ink-3">{icon}</span> : null}
          <h3 className="t-section truncate text-ink">{title}</h3>
        </div>
        {description ? <p className="t-meta max-w-prose text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
