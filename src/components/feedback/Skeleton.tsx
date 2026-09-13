import { cn } from '@/lib/cn'

/**
 * A list gets a skeleton, never a spinner: the shape of what is coming is more
 * informative than the fact that something is coming, and it does not shift the
 * layout when the rows arrive.
 *
 * The shimmer travels rather than pulsing. A pulse makes the whole screen
 * breathe at once, which is exactly as distracting as it sounds on a workspace
 * you keep open all day; a sweep reads as "loading" and then stops being
 * noticed. It is disabled outright under `prefers-reduced-motion`.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('skeleton rounded-md bg-sunken', className)}
      aria-hidden
    />
  )
}

function SkeletonRow({ delayMs }: { delayMs: number }) {
  return (
    <div
      className="skeleton h-10 w-full rounded-md bg-sunken"
      style={{ animationDelay: `${delayMs}ms` }}
      aria-hidden
    />
  )
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        // The staggered delay stops the rows reading as one solid block.
        <SkeletonRow key={i} delayMs={i * 90} />
      ))}
    </div>
  )
}
