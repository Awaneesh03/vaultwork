import { fromDateStr } from '@/lib/date'
import type { GreetingKey } from '@/services'
import type { DateStr } from '@/types/entities'
import { GREETINGS } from '../greeting'

/**
 * Greeting, date, and one sentence about the day.
 *
 * Every part is derived: the greeting from the clock port's own instant, the
 * date from the same `today` the rest of the screen is computed against, the
 * sentence from the live counts. Nothing here is written by hand, so the header
 * cannot claim a different day from the lists underneath it.
 *
 * The tone is deliberately flat. A daily driver that opens with encouragement
 * is a daily driver you stop reading by the second week.
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
  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="t-page text-ink">{GREETINGS[greeting]}.</h2>
        {/* A real <time>, so the date is machine-readable as well as legible. */}
        <time dateTime={today} className="t-meta text-ink-3">
          {fromDateStr(today).toLocaleDateString(undefined, LONG_DATE)}
        </time>
      </div>
      <p className="t-body text-ink-2">{headline}</p>
    </header>
  )
}
