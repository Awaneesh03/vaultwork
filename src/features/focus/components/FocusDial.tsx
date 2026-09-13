import { cn } from '@/lib/cn'

/**
 * The countdown, as a ring.
 *
 * A bare number tells you how long is left; a ring tells you how much of the
 * session is *gone*, which is the thing you actually glance up to check. The
 * two together answer both without asking anyone to do arithmetic.
 *
 * The geometry is deliberately plain: one track, one progress arc, one very
 * large numeral. No tick marks, no glow, no second ring — this is the one
 * screen in Vaultwork that is meant to be uninteresting to look at for
 * twenty-five minutes at a time.
 *
 * The arc is driven by `stroke-dashoffset` rather than by rebuilding a path, so
 * the browser can animate it without layout work and the component re-renders
 * once a second doing almost nothing.
 */

const SIZE = 288
const STROKE = 6
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function FocusDial({
  elapsedFraction,
  display,
  caption,
  overrun = false,
  className,
}: {
  /** 0 at the start of the session, 1 once the planned time is gone. */
  elapsedFraction: number
  /** The large numerals, already formatted. */
  display: string
  /** Session kind and planned length, under the clock. */
  caption?: string
  /** True once the planned time has run out and the session is finishing. */
  overrun?: boolean
  className?: string
}) {
  const progress = Math.min(1, Math.max(0, elapsedFraction))

  return (
    <div
      className={cn('relative grid shrink-0 place-items-center', className)}
      style={{ width: SIZE, height: SIZE }}
    >
      {/* Rotated so the arc starts at twelve o'clock rather than at three. */}
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden
        className="-rotate-90"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={overrun ? 'var(--color-warn)' : 'var(--color-accent)'}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          /*
           * One second, linear. The arc has to track the clock exactly; easing
           * it would make the ring disagree with the number beside it.
           * Reduced-motion users get the global override in globals.css, which
           * collapses this to effectively instant — the position stays correct
           * either way because it is derived, not animated into place.
           */
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
        <p
          className={cn(
            'tabular font-mono text-[68px] leading-none font-light tracking-tight',
            overrun ? 'text-warn' : 'text-ink',
          )}
          role="timer"
          /*
           * Deliberately not announced. A countdown that interrupts a screen
           * reader every second is unusable; the session's start and finish are
           * where the information actually is, and those are announced.
           */
          aria-live="off"
        >
          {display}
        </p>
        {caption ? <p className="t-meta text-ink-3">{caption}</p> : null}
      </div>
    </div>
  )
}
