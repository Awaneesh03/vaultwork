import type { ReactNode } from 'react'
import { CalendarDays, Mail, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatDayLabel, formatTime, toDateStr, toTimeStr } from '@/lib/date'
import type { CalendarEvent, EmailSignal, ExternalState } from '@/services'
import type { DateStr, Timestamp } from '@/types/entities'

/**
 * Calendar and email on Today (M19.1) — shown only when a source answered.
 *
 * External facts, and marked as such: each section carries an "External"
 * badge, says where it came from and when, and never uses the task row. An
 * email is not a task and a meeting is not a Vaultwork deadline; they sit
 * beside the plan, they do not join it. A source that is not connected shows
 * nothing here — the footer says it is not connected — and a source that
 * failed says so in one line without touching anything else on the page.
 */

type Calendar = ExternalState<CalendarEvent> | undefined
type Email = ExternalState<EmailSignal> | undefined

const clock = (at: Timestamp) => formatTime(toTimeStr(new Date(at)))

function Header({
  icon,
  title,
  source,
  fetchedAt,
}: {
  icon: ReactNode
  title: string
  source: string
  fetchedAt: Timestamp
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {icon}
      <h2 className="t-eyebrow text-ink-3">{title}</h2>
      <Badge tone="info">External</Badge>
      <span className="text-meta text-ink-3">
        From {source} · updated {clock(fetchedAt)}
      </span>
    </div>
  )
}

function CalendarSection({
  state,
  today,
}: {
  state: ExternalState<CalendarEvent>
  today: DateStr
}) {
  if (state.state === 'unavailable') return null
  if (state.state === 'error') {
    return <p className="text-body text-warn">Your calendar couldn&apos;t be read just now.</p>
  }
  return (
    <section aria-label="Calendar" className="flex flex-col gap-2">
      <Header
        icon={<CalendarDays size={13} className="text-info" aria-hidden />}
        title="Calendar"
        source="your calendar"
        fetchedAt={state.fetchedAt}
      />
      {state.items.length === 0 ? (
        <p className="text-body text-ink-3">Nothing on your calendar this week.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {state.items.map((event) => {
            const day = toDateStr(new Date(event.start))
            const when = event.allDay ? 'All day' : clock(event.start)
            return (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 text-body">
                <span className="tabular shrink-0 text-meta text-ink-3">
                  {day === today ? when : `${formatDayLabel(day, today)} · ${when}`}
                </span>
                <span className="min-w-0 flex-1 break-words text-ink-2">{event.title}</span>
                {event.status === 'tentative' ? (
                  <span className="text-meta text-ink-3">tentative</span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {state.omitted > 0 ? (
        <p className="text-meta text-ink-3">{state.omitted} more not shown.</p>
      ) : null}
    </section>
  )
}

function EmailSection({ state }: { state: ExternalState<EmailSignal> }) {
  if (state.state === 'unavailable') return null
  if (state.state === 'error') {
    return <p className="text-body text-warn">Your email couldn&apos;t be read just now.</p>
  }
  return (
    <section aria-label="Important emails" className="flex flex-col gap-2">
      <Header
        icon={<Mail size={13} className="text-info" aria-hidden />}
        title="Important emails"
        source="your email"
        fetchedAt={state.fetchedAt}
      />
      {state.items.length === 0 ? (
        <p className="text-body text-ink-3">No important email right now.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {state.items.map((signal) => (
            <li key={signal.id} className="flex flex-col text-body">
              <span className="break-words text-ink-2">
                <span className="font-medium text-ink">{signal.sender}</span> — {signal.subject}
              </span>
              {signal.snippet.length > 0 ? (
                <span className="break-words text-meta text-ink-3">{signal.snippet}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {state.omitted > 0 ? (
        <p className="text-meta text-ink-3">{state.omitted} more not shown.</p>
      ) : null}
    </section>
  )
}

const answered = (state: Calendar | Email) => state !== undefined && state.state !== 'unavailable'

export function ExternalContextSections({
  calendar,
  email,
  today,
  onCheckAgain,
}: {
  calendar: Calendar
  email: Email
  today: DateStr
  /** Reads both sources again, on request. */
  onCheckAgain?: () => void
}) {
  if (!answered(calendar) && !answered(email)) return null
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-info/25 bg-surface px-4 py-3">
      {calendar ? <CalendarSection state={calendar} today={today} /> : null}
      {email ? <EmailSection state={email} /> : null}
      {onCheckAgain ? (
        <div>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={12} aria-hidden />}
            onClick={onCheckAgain}
          >
            Check again
          </Button>
        </div>
      ) : null}
    </div>
  )
}
