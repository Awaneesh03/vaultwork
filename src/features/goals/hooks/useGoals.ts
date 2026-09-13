import { useLiveQuery } from 'dexie-react-hooks'
import {
  getGoalDetail,
  getGoalsView,
  getMilestoneTasks,
  type GoalDetailData,
  type GoalsViewData,
} from '@/services'
import { useGoalUiStore } from '@/store/goalUiStore'
import type { Id, Task } from '@/types/entities'

/**
 * The Goals screen, live.
 *
 * One query. `useLiveQuery` re-runs whenever a table it touched changes —
 * goals, milestones, projects, tasks — so completing a task anywhere in the
 * app updates the goal progress here, with no cache to invalidate.
 */
export function useGoalsView(): GoalsViewData | undefined {
  const filter = useGoalUiStore((s) => s.filter)
  const sort = useGoalUiStore((s) => s.sort)

  return useLiveQuery(
    () => getGoalsView({ filter, sort }),
    // The filter object is rebuilt on every store write, so the dependency list
    // spells out its fields rather than relying on its identity.
    [filter.state, filter.health, filter.search, sort],
  )
}

/** One goal, its checkpoints and its work. `null` when it does not exist. */
export function useGoalDetail(goalId: Id | null): GoalDetailData | null | undefined {
  return useLiveQuery(
    async () => (goalId === null ? null : ((await getGoalDetail(goalId)) ?? null)),
    [goalId],
  )
}

/** The tasks filed under one checkpoint. */
export function useMilestoneTasks(milestoneId: Id | null): Task[] | undefined {
  return useLiveQuery(
    async () => (milestoneId === null ? [] : await getMilestoneTasks(milestoneId)),
    [milestoneId],
  )
}
