import { cn } from '@/lib/cn'
import type { Priority } from '@/types/enums'
import { PRIORITY_LABELS } from '../priority'

/**
 * The priority mark.
 *
 * `none` renders nothing at all — not a grey dot, not a placeholder. Most tasks
 * have no priority, and a list where every row carries a mark is a list where
 * the mark means nothing.
 */

const COLORS: Record<Exclude<Priority, 'none'>, string> = {
  low: 'bg-priority-low',
  medium: 'bg-priority-medium',
  high: 'bg-priority-high',
  urgent: 'bg-priority-urgent',
}

export function PriorityDot({ priority, className }: { priority: Priority; className?: string }) {
  if (priority === 'none') return null

  return (
    <span
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', COLORS[priority], className)}
      title={`${PRIORITY_LABELS[priority]} priority`}
      aria-hidden
    />
  )
}
