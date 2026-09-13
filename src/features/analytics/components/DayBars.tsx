import { useId } from 'react'
import { formatDayMonth, weekdayName } from '@/lib/date'
import type { DateStr } from '@/types/entities'

/**
 * One measure over a run of local days.
 *
 * A bar chart because the job is *magnitude over discrete days* — days are
 * countable buckets, not a continuum, so bars are the honest mark; a line would
 * imply a value at three in the afternoon that nobody recorded.
 *
 * Deliberately one series. Two measures on one plot would need two scales, and
 * a dual axis makes any pair of lines look related — so "tasks" and "focus
 * minutes" get a chart each. With one series there is nothing to tell apart, so
 * there is no legend and no categorical palette: the caption names the measure
 * and the accent carries it.
 */

export interface DayPoint {
  date: DateStr
  value: number
}

export interface DayBarsProps {
  /** Oldest first. Quiet days are present as zeroes, never omitted. */
  data: DayPoint[]
  /** Names the series; with no legend, this has to. */
  label: string
  /** How a value reads: 7 → "7 tasks", 90 → "1h 30m". */
  format?: (value: number) => string
}

const HEIGHT = 96
const GAP = 2
const RADIUS = 4

/** "Thursday, 3 Sep" — the long form, for a tooltip and for a screen reader. */
const longDay = (date: DateStr): string => `${weekdayName(date)}, ${formatDayMonth(date)}`

export function DayBars({ data, label, format = (value) => String(value) }: DayBarsProps) {
  const captionId = useId()
  const max = Math.max(1, ...data.map((point) => point.value))
  const width = 100
  const slot = width / Math.max(1, data.length)
  const barWidth = Math.max(0.5, slot - GAP)

  // Labelled selectively: the busiest day, and only when there was one. A
  // number over every bar is noise that hides the shape it is printed on.
  const peak = data.reduce(
    (best, point, index) => (point.value > best.value ? { index, value: point.value } : best),
    { index: -1, value: 0 },
  )

  return (
    <figure className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3.5 shadow-[var(--shadow-sm)]">
      <figcaption id={captionId} className="text-body font-medium text-ink-2">
        {label}
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={captionId}
        className="h-24 w-full"
      >
        {/* A baseline, and nothing else. A grid behind seven bars is furniture. */}
        <line
          x1={0}
          y1={HEIGHT}
          x2={width}
          y2={HEIGHT}
          stroke="var(--color-line)"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />

        {data.map((point, index) => {
          const height = point.value === 0 ? 0 : Math.max(2, (point.value / max) * (HEIGHT - 6))
          const x = index * slot + GAP / 2
          return (
            <g key={point.date}>
              {/*
                A full-height target behind each bar, so a two-pixel bar — and a
                zero day, which has no bar at all — is still something you can
                point at and get an answer from.
              */}
              <rect
                x={x}
                y={0}
                width={barWidth}
                height={HEIGHT}
                fill="transparent"
                className="hover:fill-sunken"
              >
                <title>{`${longDay(point.date)} — ${format(point.value)}`}</title>
              </rect>
              {height > 0 ? (
                <rect
                  x={x}
                  y={HEIGHT - height}
                  width={barWidth}
                  height={height}
                  rx={Math.min(RADIUS, barWidth / 2)}
                  fill="var(--color-accent)"
                  pointerEvents="none"
                />
              ) : null}
            </g>
          )
        })}
      </svg>

      {/* Endpoints and the peak. Labelling all ninety columns would crowd the
          axis without telling anyone anything the tooltip does not. */}
      <div className="flex justify-between gap-2 font-mono text-micro text-ink-3">
        <span>{data[0] ? formatDayMonth(data[0].date) : ''}</span>
        {peak.index >= 0 && data[peak.index] ? (
          <span className="text-accent">
            peak {format(peak.value)} · {formatDayMonth(data[peak.index]!.date)}
          </span>
        ) : null}
        <span>{data.length > 0 ? formatDayMonth(data[data.length - 1]!.date) : ''}</span>
      </div>

      {/*
        The same numbers as a table, for a screen reader and for anyone who
        cannot use a hover layer. Identity is never carried by colour alone —
        this is the text that makes that true.
      */}
      <table className="sr-only">
        <caption>{label} by day</caption>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <th scope="row">{longDay(point.date)}</th>
              <td>{format(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
