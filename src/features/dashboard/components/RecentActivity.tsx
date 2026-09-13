import { Link } from 'react-router-dom'
import { formatEventTime } from '@/lib/date'
import type { ActivityEntry } from '@/services'
import type { DateStr, Timestamp } from '@/types/entities'

/**
 * What has actually happened, straight from the append-only event log.
 *
 * The Dashboard is a *reader* here and nothing else: it renders rows that
 * already exist, in the order they were written. Opening this screen writes no
 * event, and no line below is synthesised to fill the list out — an empty log
 * shows an empty state, because "no recent activity" is the truth in that case.
 *
 * Labels are resolved in the query service against the rows the events name;
 * this file only lays them out.
 */
export function RecentActivity({
  activity,
  now,
  today,
}: {
  activity: ActivityEntry[]
  now: Timestamp
  today: DateStr
}) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {activity.map((entry) => {
        const when = formatEventTime(entry.at, now, today)

        return (
          <li key={entry.id} className="flex items-baseline gap-2.5 px-3.5 py-2">
            <span className="min-w-0 flex-1 truncate text-body text-ink-2">
              {entry.href ? (
                <Link to={entry.href} className="hover:text-accent">
                  {entry.label}
                </Link>
              ) : (
                entry.label
              )}
            </span>
            {/* A real <time>: the relative wording is for people, the datetime
                attribute is the instant it actually refers to. */}
            <time
              dateTime={new Date(entry.at).toISOString()}
              className="tabular shrink-0 text-meta text-ink-3"
            >
              {when}
            </time>
          </li>
        )
      })}
    </ul>
  )
}
