import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The top of every screen, so that every screen begins the same way.
 *
 * One title, one optional sentence saying what this place is for, and the
 * actions that belong to the whole page. Compact on purpose — a workspace
 * cannot afford a hero banner on a screen you open forty times a day.
 */
export function PageHeader({
  title,
  description,
  icon,
  meta,
  actions,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  /**
   * Counts and totals that belong beside the title rather than under it — how
   * many tasks, how long they add up to. Sits on the title's baseline so the
   * eye reads "Today · 12 · ≈3h" as one statement.
   */
  meta?: ReactNode
  /** Page-level actions, right-aligned. */
  actions?: ReactNode
  /** Filters or tabs that belong under the title rather than beside it. */
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {icon ? (
              /*
               * The icon sits in a tinted tile rather than floating beside the
               * words. It gives every page the same anchor in the same place,
               * which is most of what makes a set of screens feel like one
               * application when you move between them quickly.
               */
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"
                aria-hidden
              >
                {icon}
              </span>
            ) : null}
            <h2 className="t-page min-w-0 text-ink">{title}</h2>
            {meta ? (
              <span className="flex items-center gap-2 text-meta text-ink-3">{meta}</span>
            ) : null}
          </div>
          {description ? <p className="t-meta max-w-prose text-ink-3">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </header>
  )
}

/**
 * A labelled band inside a page.
 *
 * The eyebrow is the only uppercase text in the application, and it is confined
 * to this component so it stays that way.
 */
export function SectionHeader({
  label,
  actions,
  className,
}: {
  label: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <h3 className="t-eyebrow shrink-0 text-ink-3">{label}</h3>
      <span className="h-px min-w-4 flex-1 bg-line" aria-hidden />
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
