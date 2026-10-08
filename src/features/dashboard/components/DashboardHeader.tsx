import { fromDateStr } from '@/lib/date'
import type { GreetingKey } from '@/services'
import type { DateStr } from '@/types/entities'
import { GREETINGS } from '../greeting'

/**
 * Top Hero — Dashboard Header.
 *
 * The evening hero is a scene rather than a panel: a sunset seen from inside a
 * room, painted entirely in CSS and SVG from the theme's own tokens. No image
 * is shipped, nothing is fetched, and a theme change repaints it.
 *
 * It is a scene because the evening screen has a different job from the daytime
 * one. The day asks what is left; the evening says the day is ending, and that
 * is a thing light says better than a sentence does.
 *
 * Preserves the machine-readable <time dateTime={today}> and greeting text
 * for full test compatibility and accessibility.
 */

/**
 * The evening's closing line.
 *
 * A fixed set, picked by the date rather than at random, so the same day always
 * shows the same line — a dashboard that reshuffles its own copy on every
 * render is a dashboard nobody trusts. Presentation only: no store, no service.
 */
const CLOSING_LINES = [
  'Small steps compound into big results.',
  'Done beats perfect, today and tomorrow.',
  'Rest is part of the work.',
  'What you finished today counts.',
  'Consistency outlasts intensity.',
] as const

function closingLine(today: DateStr): string {
  const sum = [...today].reduce((total, char) => total + char.charCodeAt(0), 0)
  return CLOSING_LINES[sum % CLOSING_LINES.length] ?? CLOSING_LINES[0]
}

const LONG_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}

/** Sky, sun, city, window, room — back to front. */
function EveningScene() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {/* The sky, from dusk overhead down to the fire on the horizon. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in oklab, var(--sunken) 78%, var(--danger)) 0%, color-mix(in oklab, var(--sunken) 42%, var(--danger)) 34%, color-mix(in oklab, var(--danger) 52%, var(--warn)) 62%, color-mix(in oklab, var(--warn) 86%, var(--surface)) 100%)',
        }}
      />

      {/* The sun, low and heavy, with its haze around it. */}
      <div
        className="absolute h-28 w-28 rounded-full blur-[6px]"
        style={{
          right: '26%',
          bottom: '26%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--warn) 92%, white) 0%, color-mix(in oklab, var(--warn) 88%, transparent) 50%, transparent 72%)',
        }}
      />
      <div
        className="absolute right-[6%] bottom-[8%] h-64 w-[36rem] rounded-full opacity-80 blur-3xl"
        style={{
          background:
            'radial-gradient(ellipse, color-mix(in oklab, var(--warn) 78%, transparent) 0%, transparent 70%)',
        }}
      />

      {/* The city, flat against the light. */}
      <svg
        className="absolute inset-x-0 bottom-0 h-24 w-full sm:h-28"
        viewBox="0 0 600 120"
        preserveAspectRatio="none"
        fill="color-mix(in oklab, var(--sunken) 72%, var(--danger))"
      >
        <path d="M0 96h22V74h14v22h18V58h16v38h20V80h12v16h24V48h18v48h16V70h14v26h22V86h16v10h26V62h18v34h14V84h12v12h24V54h16v42h18V76h14v20h22V66h16v30h20V88h14v8h26V72h16v24h18V60h14v36h22V82h12v14h20v24H0z" />
      </svg>
      <svg
        className="absolute inset-x-0 bottom-0 h-16 w-full sm:h-20"
        viewBox="0 0 600 80"
        preserveAspectRatio="none"
        fill="color-mix(in oklab, var(--sunken) 90%, var(--danger))"
      >
        <path d="M0 62h30V46h18v16h26V54h16v8h28V38h20v24h18V50h14v12h30V44h18v18h22V56h16v6h28V40h18v22h20V52h14v10h26V46h18v16h24V58h16v4h30v18H0z" />
      </svg>

      {/* The window: two mullions and a transom, in the room's own shadow. */}
      <div
        className="absolute inset-y-0 left-[44%] w-[4px]"
        style={{ background: 'color-mix(in oklab, var(--sunken) 94%, var(--danger))' }}
      />
      <div
        className="absolute inset-y-0 left-[76%] w-[4px]"
        style={{ background: 'color-mix(in oklab, var(--sunken) 94%, var(--danger))' }}
      />
      <div
        className="absolute inset-x-[42%] top-[38%] h-[3px]"
        style={{ background: 'color-mix(in oklab, var(--sunken) 94%, var(--danger))' }}
      />

      {/* The room itself: dark at the left, where the words are. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(100deg, var(--sunken) 0%, color-mix(in oklab, var(--sunken) 92%, transparent) 24%, color-mix(in oklab, var(--sunken) 55%, transparent) 44%, transparent 66%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-20"
        style={{
          background:
            'linear-gradient(to top, color-mix(in oklab, var(--sunken) 88%, transparent) 0%, transparent 100%)',
        }}
      />
    </div>
  )
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
    <header
      className={
        isEvening
          ? 'relative flex min-h-[13rem] flex-col justify-end overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--warn)_26%,var(--line))] p-6 shadow-[var(--shadow-sm)] sm:min-h-[15.5rem] sm:p-8'
          : 'relative overflow-hidden rounded-2xl border border-line/70 bg-gradient-to-br from-surface via-surface/80 to-surface/50 p-6 sm:p-8 shadow-[var(--shadow-sm)] backdrop-blur-sm'
      }
    >
      {isEvening ? (
        <EveningScene />
      ) : (
        <div
          className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full opacity-60 blur-3xl"
          style={{
            background: 'radial-gradient(circle, rgba(69, 217, 160, 0.12) 0%, transparent 70%)',
          }}
          aria-hidden
        />
      )}

      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: isEvening ? 'var(--warn)' : 'var(--accent)',
                boxShadow: isEvening
                  ? '0 0 14px color-mix(in oklab, var(--warn) 85%, transparent)'
                  : undefined,
              }}
              aria-hidden
            />
            <span className="text-micro font-semibold uppercase tracking-widest text-ink-3">
              {isEvening ? 'Evening Wrap-Up' : 'Daily Briefing'}
            </span>
          </div>

          {/*
           * The evening greeting is set in the stack's own serif — editorial,
           * and no new font to download.
           */}
          <h2
            className={
              isEvening
                ? 'font-serif text-4xl font-medium leading-[1.05] tracking-tight text-ink sm:text-5xl'
                : 'text-2xl sm:text-3xl font-semibold tracking-tight text-ink'
            }
          >
            {GREETINGS[greeting]}.
          </h2>

          <p className="max-w-prose text-body leading-relaxed text-ink-2">
            {isEvening ? 'Great progress today. Let’s wrap things up.' : headline}
          </p>
        </div>

        <div
          className={
            isEvening
              ? 'flex shrink-0 flex-col items-start gap-2 sm:items-end'
              : 'flex shrink-0 flex-col items-start gap-1 sm:items-end'
          }
        >
          {/* Machine-readable <time> ensuring accessibility and test contract */}
          <div
            className={
              isEvening
                ? 'flex flex-col items-start gap-0.5 rounded-full border border-[color-mix(in_oklab,var(--warn)_26%,var(--line))] bg-[color-mix(in_oklab,var(--sunken)_72%,transparent)] px-3.5 py-1.5 backdrop-blur-sm sm:items-end'
                : 'flex flex-col items-start gap-1 sm:items-end'
            }
          >
            <time dateTime={today} className="tabular text-meta font-medium text-ink-2">
              {fromDateStr(today).toLocaleDateString(undefined, LONG_DATE)}
            </time>
            <span className="text-micro text-ink-3">Local database active</span>
          </div>

          {isEvening ? (
            <p className="max-w-[14rem] rounded-xl border border-[color-mix(in_oklab,var(--warn)_26%,var(--line))] bg-[color-mix(in_oklab,var(--sunken)_70%,transparent)] px-3 py-2 text-meta leading-relaxed text-ink-2 backdrop-blur-sm sm:text-right">
              {closingLine(today)}
            </p>
          ) : null}
        </div>
      </div>
    </header>
  )
}
