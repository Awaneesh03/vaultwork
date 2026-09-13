import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ANALYTICS_RANGES, getAnalytics, type AnalyticsData, type AnalyticsRange } from '@/services'

/**
 * Analytics for the chosen range, live.
 *
 * One query. `useLiveQuery` re-runs whenever the tables it read change — events
 * and focus sessions — so finishing a task on the Today screen moves the bars
 * here without a refresh button and without a second copy of the counts held in
 * React state.
 *
 * The range lives in component state rather than in the database: it is how
 * someone is looking at their history, not a fact about it, and it should not
 * outlive the screen or sync anywhere.
 */

export interface AnalyticsController {
  /** `undefined` while the first query is in flight — `DataView`'s signal. */
  data: AnalyticsData | undefined
  range: AnalyticsRange
  setRange: (range: AnalyticsRange) => void
  /** The offered ranges, so the view does not reach past the hook for them. */
  ranges: readonly AnalyticsRange[]
}

export function useAnalytics(initialRange: AnalyticsRange = 7): AnalyticsController {
  const [range, setRange] = useState<AnalyticsRange>(initialRange)
  const data = useLiveQuery(() => getAnalytics(range), [range])
  return { data, range, setRange, ranges: ANALYTICS_RANGES }
}
