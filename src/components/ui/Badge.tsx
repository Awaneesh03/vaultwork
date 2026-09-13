import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * A small state mark.
 *
 * Every tone pairs a tinted background with text in the *same* hue rather than
 * a saturated fill: a row of solid red and green pills reads as decoration, and
 * the one that actually matters stops standing out.
 *
 * Colour is never the only carrier. A badge always has a label, and callers
 * pass an icon for the states where being sure matters — which is what keeps
 * this readable for a colour-blind reader and in a screenshot printed in grey.
 */

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'confirm'
  | 'ok'
  | 'warn'
  | 'danger'
  | 'info'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-ink-2 border-line',
  accent: 'bg-accent-soft text-accent border-accent-line/50',
  confirm: 'bg-accent-2-soft text-accent-2 border-accent-2-line/50',
  ok: 'bg-ok-soft text-ok border-ok/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  info: 'bg-info-soft text-info border-info/25',
}

export function Badge({
  tone = 'neutral',
  icon,
  className,
  title,
  role,
  children,
}: {
  tone?: BadgeTone
  icon?: ReactNode
  className?: string | undefined
  /** The longer explanation, for hover. The label still carries the meaning. */
  title?: string | undefined
  /**
   * `status` when the badge *reports* something that changes on its own — a
   * connection coming up, a sync finishing. A screen reader should hear those
   * without going looking; a static label should not interrupt anything.
   */
  role?: 'status' | undefined
  children: ReactNode
}) {
  return (
    <span
      role={role}
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[1.5px]',
        'text-[11px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {icon ? <span className="shrink-0" aria-hidden>{icon}</span> : null}
      {children}
    </span>
  )
}

/**
 * A count beside a label. Zero renders nothing, deliberately: a permanent "0"
 * teaches you to stop reading the number.
 */
export function CountBadge({
  value,
  tone = 'neutral',
  className,
}: {
  value: number
  tone?: BadgeTone
  className?: string
}) {
  if (value === 0) return null
  return (
    <span
      className={cn(
        'tabular inline-flex h-[17px] min-w-[17px] shrink-0 items-center justify-center',
        'rounded-full border px-1 text-[10.5px] font-medium',
        TONES[tone],
        className,
      )}
    >
      {value}
    </span>
  )
}
