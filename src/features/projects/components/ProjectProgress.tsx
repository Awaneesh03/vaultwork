import { cn } from '@/lib/cn'

/**
 * A project's progress, as a bar.
 *
 * Two decisions worth stating. The bar is `role="progressbar"` with real
 * `aria-valuenow`/`valuetext`, because "67%" drawn as a coloured rectangle is
 * invisible to a screen reader. And it is tinted with the project's own accent
 * rather than the app's, so a row's colour, icon and bar all say the same
 * thing — which is what lets you find a project by its colour at a glance.
 */
export function ProjectProgress({
  percent,
  label,
  accent,
  className,
}: {
  percent: number
  /** What the number means, for assistive technology. */
  label: string
  /** A CSS colour — normally `projectColorVar(project.color)`. */
  accent?: string
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))

  return (
    <div
      role="progressbar"
      // `aria-label` names the bar, `aria-valuetext` describes its value. A
      // progressbar carrying only a valuetext has no accessible name at all,
      // which is how a screen reader ends up announcing a bare "50 percent".
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${clamped}%`}
      // The track is `--line`, not `--sunken`: sunken is barely distinguishable
      // from a card's own surface, and a progress bar whose track you cannot see
      // shows the fraction without the denominator.
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div
        className="h-full rounded-full transition-[width] duration-[var(--duration-base)]"
        style={{
          width: `${clamped}%`,
          backgroundColor: accent ?? 'var(--accent)',
        }}
      />
    </div>
  )
}
