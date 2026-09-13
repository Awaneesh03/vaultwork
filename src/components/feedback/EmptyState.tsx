import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Empty states are per-view and specific.
 *
 * Every one answers three questions: what is empty, why it is empty, and what
 * to do next. "No data" answers none of them, and a screen that says it has
 * wasted the one moment the user was actually looking for guidance.
 *
 * The dashed border and the recessed icon mark this as *an absence* rather than
 * a card that failed to load — the shape itself carries the message before the
 * words are read.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-line',
        'bg-surface/40 px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-ink-3"
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <p className="t-body font-medium text-ink">{title}</p>
      {description ? (
        <p className="t-meta max-w-sm leading-relaxed text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  )
}
