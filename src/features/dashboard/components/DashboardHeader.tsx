import { fromDateStr } from '@/lib/date'
import type { DateStr } from '@/types/entities'
import { GREETINGS, SCENE_COPY, SCENE_TINT } from '../greeting'
import { greetingForTimeOfDay, type TimeOfDay } from '../timeOfDay'
import { DashboardScene } from './DashboardScenes'

/**
 * Top Hero — Dashboard Header.
 *
 * A window onto the hour: morning, afternoon, evening and night each paint
 * their own sky behind the same words (see `DashboardScenes`). The scene and
 * the greeting are chosen from one value — the time of day — so they cannot
 * disagree: at 21:00 the moon is up and the heading says good night.
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

export function DashboardHeader({ timeOfDay, today }: { timeOfDay: TimeOfDay; today: DateStr }) {
  const tint = SCENE_TINT[timeOfDay]
  const copy = SCENE_COPY[timeOfDay]
  // The closing line belongs to the end of the day, as it always has.
  const windingDown = timeOfDay === 'evening' || timeOfDay === 'night'
  const edge = `color-mix(in oklab, ${tint} 26%, var(--line))`
  const chip = {
    borderColor: edge,
    background: 'color-mix(in oklab, var(--sunken) 72%, transparent)',
  }

  return (
    <header
      data-scene={timeOfDay}
      className="relative flex min-h-[13rem] flex-col justify-end overflow-hidden rounded-2xl border p-6 shadow-[var(--shadow-sm)] sm:min-h-[15.5rem] sm:p-8"
      style={{ borderColor: edge }}
    >
      <DashboardScene timeOfDay={timeOfDay} />

      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: tint,
                boxShadow: `0 0 14px color-mix(in oklab, ${tint} 85%, transparent)`,
              }}
              aria-hidden
            />
            <span className="text-micro font-semibold uppercase tracking-widest text-ink-3">
              {copy.eyebrow}
            </span>
          </div>

          {/* Set in the stack's own serif — editorial, and no font to download. */}
          <h2 className="font-serif text-4xl font-medium leading-[1.05] tracking-tight text-ink sm:text-5xl">
            {GREETINGS[greetingForTimeOfDay(timeOfDay)]}.
          </h2>

          <p className="max-w-prose text-body leading-relaxed text-ink-2">{copy.subtitle}</p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {/* Machine-readable <time> ensuring accessibility and test contract */}
          <div
            className="flex flex-col items-start gap-0.5 rounded-full border px-3.5 py-1.5 backdrop-blur-sm sm:items-end"
            style={chip}
          >
            <time dateTime={today} className="tabular text-meta font-medium text-ink-2">
              {fromDateStr(today).toLocaleDateString(undefined, LONG_DATE)}
            </time>
            <span className="text-micro text-ink-3">Local database active</span>
          </div>

          {windingDown ? (
            <p
              className="max-w-[14rem] rounded-xl border px-3 py-2 text-meta leading-relaxed text-ink-2 backdrop-blur-sm sm:text-right"
              style={{ ...chip, background: 'color-mix(in oklab, var(--sunken) 70%, transparent)' }}
            >
              {closingLine(today)}
            </p>
          ) : null}
        </div>
      </div>
    </header>
  )
}
