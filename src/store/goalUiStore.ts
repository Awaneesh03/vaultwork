import { create } from 'zustand'
import type { GoalHealthFilter, GoalSort, GoalStateFilter } from '@/services'
import type { Id } from '@/types/entities'

/**
 * Ephemeral state for the Goals screen.
 *
 * Not one goal or milestone lives here — rows come from Dexie through
 * `useLiveQuery`, so there is exactly one copy of the truth. What is here is
 * what *should* vanish on refresh, the same rule the task, project, calendar
 * and habit stores follow.
 */

export interface GoalUiFilter {
  state: GoalStateFilter
  health: GoalHealthFilter
  search: string
}

export const EMPTY_GOAL_FILTER: GoalUiFilter = {
  state: 'active',
  health: 'any',
  search: '',
}

export type GoalComposerState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; goalId: Id }

/** The milestone composer belongs to whichever goal is open. */
export type MilestoneComposerState =
  | { mode: 'closed' }
  | { mode: 'create'; goalId: Id }
  | { mode: 'edit'; milestoneId: Id }

interface GoalUiState {
  filter: GoalUiFilter
  sort: GoalSort
  selectedGoalId: Id | null
  openGoalId: Id | null
  composer: GoalComposerState
  milestoneComposer: MilestoneComposerState
  searchFocusNonce: number

  setSearch: (search: string) => void
  setState: (state: GoalStateFilter) => void
  setHealth: (health: GoalHealthFilter) => void
  setSort: (sort: GoalSort) => void
  clearFilter: () => void

  select: (id: Id | null) => void
  open: (id: Id | null) => void
  openCreate: () => void
  openEdit: (goalId: Id) => void
  closeComposer: () => void

  openMilestoneCreate: (goalId: Id) => void
  openMilestoneEdit: (milestoneId: Id) => void
  closeMilestoneComposer: () => void

  focusSearch: () => void
  reset: () => void
}

export const useGoalUiStore = create<GoalUiState>((set) => ({
  filter: EMPTY_GOAL_FILTER,
  sort: 'manual',
  selectedGoalId: null,
  openGoalId: null,
  composer: { mode: 'closed' },
  milestoneComposer: { mode: 'closed' },
  searchFocusNonce: 0,

  setSearch: (search) => set((s) => ({ filter: { ...s.filter, search } })),
  setState: (state) => set((s) => ({ filter: { ...s.filter, state } })),
  setHealth: (health) => set((s) => ({ filter: { ...s.filter, health } })),
  setSort: (sort) => set({ sort }),
  clearFilter: () => set((s) => ({ filter: { ...EMPTY_GOAL_FILTER, state: s.filter.state } })),

  select: (selectedGoalId) => set({ selectedGoalId }),
  open: (openGoalId) => set({ openGoalId }),
  openCreate: () => set({ composer: { mode: 'create' } }),
  openEdit: (goalId) => set({ composer: { mode: 'edit', goalId } }),
  closeComposer: () => set({ composer: { mode: 'closed' } }),

  openMilestoneCreate: (goalId) => set({ milestoneComposer: { mode: 'create', goalId } }),
  openMilestoneEdit: (milestoneId) => set({ milestoneComposer: { mode: 'edit', milestoneId } }),
  closeMilestoneComposer: () => set({ milestoneComposer: { mode: 'closed' } }),

  focusSearch: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),

  reset: () =>
    set({
      filter: EMPTY_GOAL_FILTER,
      sort: 'manual',
      selectedGoalId: null,
      openGoalId: null,
      composer: { mode: 'closed' },
      milestoneComposer: { mode: 'closed' },
    }),
}))
