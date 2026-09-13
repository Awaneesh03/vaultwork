import { cn } from '@/lib/cn'
import type { Progress } from '@/services'

/**
 * A goal's progress bar.
 *
 * A real `progressbar` with an `aria-label`, because `aria-valuetext` alone is
 * a value, not a name — a screen reader would announce "60 percent" with no
 * indication of what is 60 percent done. The counts are also rendered as text
 * beside it, so the bar is never the only way to read the number.
 *
 * The track is `bg-line` rather than `bg-sunken`: against the card surface the
 * sunken tone is invisible, and an invisible track makes 5 % look like 0 %.
 */
export function GoalProgress({
  label,
  progress,
  className,
  tone = 'accent',
}: {
  /** What is being measured, for the accessible name. */
  label: string
  progress: Progress
  className?: string
  tone?: 'accent' | 'muted'
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={progress.percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${progress.percent}% — ${progress.done} of ${progress.total}`}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-[var(--duration-base)]',
          tone === 'accent' ? 'bg-accent' : 'bg-ink-3',
        )}
        style={{ width: `${progress.percent}%` }}
      />
    </div>
  )
}
