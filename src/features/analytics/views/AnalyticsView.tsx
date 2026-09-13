import { BarChart3 } from 'lucide-react'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import { formatEstimate, formatHour } from '@/lib/date'
import { cn } from '@/lib/cn'
import type { AnalyticsData, AnalyticsRange } from '@/services'
import { DayBars } from '../components/DayBars'
import { useAnalytics } from '../hooks/useAnalytics'

/**
 * What the event log knows, drawn.
 *
 * Every figure on this screen is recomputed from the append-only event store
 * when the screen asks for it. There is no analytics table and no counter kept
 * up to date by hand, so nothing here can disagree with the history it came
 * from — and a range with nothing in it says so plainly rather than drawing a
 * confident flat line.
 */

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  7: '7 days',
  30: '30 days',
  90: '90 days',
}

/** A headline number. Not a chart, because a single value is not a shape. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-3.5 py-3 shadow-[var(--shadow-sm)]">
      <span className="t-eyebrow text-ink-3">{label}</span>
      <span className="t-stat text-ink">{value}</span>
      {hint ? <span className="t-meta text-ink-3">{hint}</span> : null}
    </div>
  )
}

function Charts({ data }: { data: AnalyticsData }) {
  return (
    <>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Tasks done"
          value={String(data.totals.tasksCompleted)}
          hint={`${data.totals.tasksCreated} created`}
        />
        <Stat label="Habits" value={String(data.totals.habitsCompleted)} hint="check-ins" />
        <Stat
          label="Focus"
          value={data.totals.focusMinutes === 0 ? '0m' : formatEstimate(data.totals.focusMinutes)}
          hint={`${data.totals.focusSessions} session${data.totals.focusSessions === 1 ? '' : 's'}`}
        />
        <Stat
          label="Busiest hour"
          value={data.busiestHour === null ? '—' : formatHour(data.busiestHour)}
          hint={`${data.totals.events} events`}
        />
      </div>

      {/*
        One measure per plot. Tasks and minutes are different units, and putting
        them on a shared axis would invent a relationship between them.
      */}
      <div className="grid gap-5 lg:grid-cols-2">
        <DayBars
          label="Tasks completed"
          data={data.days.map((day) => ({ date: day.date, value: day.tasksCompleted }))}
          format={(value) => `${value} task${value === 1 ? '' : 's'}`}
        />
        <DayBars
          label="Focus minutes"
          data={data.days.map((day) => ({ date: day.date, value: day.focusMinutes }))}
          format={(value) => (value === 0 ? 'none' : formatEstimate(value))}
        />
        <DayBars
          label="Habit check-ins"
          data={data.days.map((day) => ({ date: day.date, value: day.habitsCompleted }))}
          format={(value) => `${value} check-in${value === 1 ? '' : 's'}`}
        />
        <DayBars
          label="Notes written"
          data={data.days.map((day) => ({ date: day.date, value: day.notesTouched }))}
          format={(value) => `${value} note${value === 1 ? '' : 's'}`}
        />
      </div>
    </>
  )
}

export function AnalyticsView() {
  const { data, range, setRange, ranges } = useAnalytics()

  return (
    <div className="flex max-w-5xl flex-col gap-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="t-page flex items-center gap-2">
            <BarChart3 size={16} className="text-ink-3" aria-hidden />
            Analytics
          </h2>
          <p className="t-meta max-w-prose text-ink-3">
            Counted from the event log each time you open this, so these numbers cannot drift away
            from what actually happened.
          </p>
        </div>

        {/* The one control, above the charts it changes. */}
        <div
          className="flex items-center gap-0.5 rounded-md border border-line-strong bg-sunken p-0.5"
          role="group"
          aria-label="Range"
        >
          {ranges.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === range}
              onClick={() => setRange(option)}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-[12px] font-medium',
                'transition-colors duration-[var(--duration-fast)]',
                option === range
                  ? 'bg-surface text-ink shadow-[var(--shadow-sm)]'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              {RANGE_LABEL[option]}
            </button>
          ))}
        </div>
      </header>

      <DataView
        data={data}
        isEmpty={(loaded) => loaded.empty}
        empty={
          <EmptyState
            title="Nothing in this range yet"
            description="Completing a task, checking off a habit or running a focus session all land here. Try a longer range if you have been away."
          />
        }
      >
        {(loaded) => (
          <div className="flex flex-col gap-7">
            <Charts data={loaded} />
          </div>
        )}
      </DataView>
    </div>
  )
}
