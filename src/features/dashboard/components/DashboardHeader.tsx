import { fromDateStr } from '@/lib/date'
import type { GreetingKey } from '@/services'
import type { DateStr } from '@/types/entities'
import { GREETINGS } from '../greeting'

/**
 * Top Hero — Dashboard Header.
 *
 * Visually establishes the calm atmosphere through CSS gradients
 * and clean editorial typography without any external asset or network dependencies.
 *
 * Preserves the machine-readable <time dateTime={today}> and greeting text
 * for full test compatibility and accessibility.
 */

const LONG_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}

export function DashboardHeader({
  greeting,
  today,
  headline,
}: {
  greeting: GreetingKey
  today: DateStr
  headline: string
}) {
  const isEvening = greeting === 'evening' || greeting === 'lateNight'

  return (
    <header className="relative overflow-hidden rounded-2xl border border-line/70 bg-gradient-to-br from-surface via-surface/80 to-surface/50 p-6 sm:p-8 shadow-[var(--shadow-sm)] backdrop-blur-sm">
      {/* Subtle scenic evening atmospheric ambient glow (CSS only) */}
      <div
        className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full opacity-60 blur-3xl"
        style={{
          background: isEvening
            ? 'radial-gradient(circle, rgba(237, 180, 78, 0.14) 0%, rgba(179, 156, 245, 0.08) 50%, transparent 70%)'
            : 'radial-gradient(circle, rgba(69, 217, 160, 0.12) 0%, transparent 70%)',
        }}
        aria-hidden
      />

      {/* Subtle horizon silhouette contour along the bottom */}
      <svg
        className="pointer-events-none absolute -right-4 -bottom-3 h-20 w-80 text-line/25 sm:h-24 sm:w-96"
        viewBox="0 0 384 96"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          d="M0 80C48 72 96 85 144 76C192 67 240 50 288 56C336 62 360 78 384 74V96H0V80Z"
          fill="currentColor"
          fillOpacity="0.4"
        />
        <path
          d="M60 84C108 78 156 88 204 81C252 74 300 60 348 65C368 67 378 72 384 74V96H60V84Z"
          fill="currentColor"
          fillOpacity="0.6"
        />
      </svg>

      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: isEvening ? 'var(--warn)' : 'var(--accent)',
              }}
              aria-hidden
            />
            <span className="text-micro font-semibold uppercase tracking-widest text-ink-3">
              {isEvening ? 'Evening Wrap-Up' : 'Daily Briefing'}
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
            {GREETINGS[greeting]}.
          </h2>

          <p className="text-body leading-relaxed text-ink-2">
            {isEvening ? 'Great progress today. Let’s wrap things up.' : headline}
          </p>

          {isEvening ? <p className="t-meta text-ink-3">{headline}</p> : null}
        </div>

        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          {/* Machine-readable <time> ensuring accessibility and test contract */}
          <time dateTime={today} className="tabular text-meta font-medium text-ink-2">
            {fromDateStr(today).toLocaleDateString(undefined, LONG_DATE)}
          </time>
          <span className="text-micro text-ink-3">Local database active</span>
        </div>
      </div>
    </header>
  )
}
