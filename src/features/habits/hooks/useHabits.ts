import { useLiveQuery } from 'dexie-react-hooks'
import {
  getHabitDetail,
  getHabitsView,
  type HabitDetailData,
  type HabitsViewData,
} from '@/services'
import { useHabitUiStore } from '@/store/habitUiStore'
import type { Id } from '@/types/entities'

/**
 * The Habits screen, live.
 *
 * One query. `useLiveQuery` re-runs whenever a table it touched changes —
 * habits, habitEntries, settings — so ticking a habit anywhere in the app
 * refreshes the list, the streaks and the summary together, with no cache to
 * invalidate.
 */
export function useHabitsView(): HabitsViewData | undefined {
  const filter = useHabitUiStore((s) => s.filter)

  return useLiveQuery(
    () =>
      getHabitsView({
        state: filter.state,
        todayState: filter.today,
        frequency: filter.frequency,
        search: filter.search,
      }),
    // The filter object is rebuilt on every store write, so the dependency list
    // spells out its fields rather than relying on its identity.
    [filter.state, filter.today, filter.frequency, filter.search],
  )
}

/** One habit and its history. `null` when it does not exist. */
export function useHabitDetail(habitId: Id | null): HabitDetailData | null | undefined {
  return useLiveQuery(
    async () => (habitId === null ? null : ((await getHabitDetail(habitId)) ?? null)),
    [habitId],
  )
}
