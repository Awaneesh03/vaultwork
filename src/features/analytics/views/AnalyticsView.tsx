import { BarChart3 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
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

/**
 * The page's information hierarchy, in three bands.
 *
 * Four equally-sized charts is a wall, not an answer — every measure shouting
 * at the same volume means the reader has to do the ranking the page should
 * have done. So: one headline measure with its own full-width trend, then the
 * supporting series at half the prominence, then the facts that are numbers
 * rather than shapes.
 *
 * Tasks completed is the headline because it is the only series here that
 * answers "did I move my own work forward", which is the question the page
 * exists for. The rest are context for it.
 */
function Charts({ data }: { data: AnalyticsData }) {
  const series = (pick: (day: AnalyticsData['days'][number]) => number) =>
    data.days.map((day) => ({ date: day.date, value: pick(day) }))

  const perDay = data.totals.tasksCompleted / Math.max(1, data.days.length)

  return (
    <>
      {/* ── the headline ─────────────────────────────────────────────── */}
      <section className="panel flex flex-col gap-4 p-4" aria-label="Tasks completed">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-0.5">
            <span className="t-eyebrow text-ink-3">Tasks completed</span>
            <span className="tabular text-[40px] leading-none font-semibold tracking-tight text-ink">
              {data.totals.tasksCompleted}
            </span>
          </div>
          {/*
            Two figures that put the headline in proportion. An average is only
            honest alongside the count it came from, so both are shown.
          */}
          <dl className="flex gap-6 text-meta text-ink-3">
            <div className="flex flex-col gap-0.5">
              <dt>Per day</dt>
              <dd className="tabular text-title text-ink-2">{perDay.toFixed(1)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt>Created</dt>
              <dd className="tabular text-title text-ink-2">{data.totals.tasksCreated}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt>Busiest hour</dt>
              <dd className="tabular text-title text-ink-2">
                {data.busiestHour === null ? '—' : formatHour(data.busiestHour)}
              </dd>
            </div>
          </dl>
        </div>

        <DayBars
          label="Tasks completed"
          data={series((day) => day.tasksCompleted)}
          format={(value) => `${value} task${value === 1 ? '' : 's'}`}
          bare
        />
      </section>

      {/* ── the supporting series ────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <DayBars
          label="Focus minutes"
          total={data.totals.focusMinutes === 0 ? '0m' : formatEstimate(data.totals.focusMinutes)}
          data={series((day) => day.focusMinutes)}
          format={(value) => (value === 0 ? 'none' : formatEstimate(value))}
        />
        <DayBars
          label="Habit check-ins"
          total={String(data.totals.habitsCompleted)}
          data={series((day) => day.habitsCompleted)}
          format={(value) => `${value} check-in${value === 1 ? '' : 's'}`}
        />
        <DayBars
          label="Notes written"
          total={String(data.totals.notesTouched)}
          data={series((day) => day.notesTouched)}
          format={(value) => `${value} note${value === 1 ? '' : 's'}`}
        />
      </div>

      {/*
        The facts no chart carries.

        Every measure with a shape now shows its own total beside its caption,
        so this strip holds only what is left. Naming the same measure in two
        places on one page is how a summary strip and a chart grid end up
        repeating each other, and how a reader learns to skip both.
      */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {(
          [
            ['Focus sessions', String(data.totals.focusSessions)],
            ['Events recorded', String(data.totals.events)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 bg-surface px-3.5 py-3">
            <dt className="t-eyebrow text-ink-3">{label}</dt>
            <dd className="tabular text-title font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

export function AnalyticsView() {
  const { data, range, setRange, ranges } = useAnalytics()

  return (
    <div className="flex max-w-5xl flex-col gap-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          icon={<BarChart3 size={15} aria-hidden />}
          title="Analytics"
          description="Counted from the event log each time you open this, so these numbers cannot drift away from what actually happened."
        />

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
                'rounded-[5px] px-2.5 py-1 text-body font-medium',
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
