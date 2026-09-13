import { create } from 'zustand'
import type { HabitFrequency } from '@/services'
import type { Id } from '@/types/entities'

/**
 * Ephemeral state for the Habits screen.
 *
 * Not one habit or entry lives here — rows come from Dexie through
 * `useLiveQuery`, so there is exactly one copy of the truth. What is here is
 * what *should* vanish on refresh, the same rule the task, project and calendar
 * stores follow.
 */

export type HabitStateFilter = 'active' | 'archived' | 'all'
export type HabitTodayFilter = 'any' | 'done' | 'todo'

export interface HabitFilter {
  state: HabitStateFilter
  today: HabitTodayFilter
  frequency: HabitFrequency | 'any'
  search: string
}

export const EMPTY_HABIT_FILTER: HabitFilter = {
  state: 'active',
  today: 'any',
  frequency: 'any',
  search: '',
}

export type HabitComposerState =
  { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; habitId: Id }

interface HabitUiState {
  filter: HabitFilter
  selectedHabitId: Id | null
  openHabitId: Id | null
  composer: HabitComposerState
  searchFocusNonce: number

  setSearch: (search: string) => void
  setState: (state: HabitStateFilter) => void
  setToday: (today: HabitTodayFilter) => void
  setFrequency: (frequency: HabitFrequency | 'any') => void
  clearFilter: () => void

  select: (id: Id | null) => void
  open: (id: Id | null) => void
  openCreate: () => void
  openEdit: (habitId: Id) => void
  closeComposer: () => void
  focusSearch: () => void
  reset: () => void
}

export const useHabitUiStore = create<HabitUiState>((set) => ({
  filter: EMPTY_HABIT_FILTER,
  selectedHabitId: null,
  openHabitId: null,
  composer: { mode: 'closed' },
  searchFocusNonce: 0,

  setSearch: (search) => set((s) => ({ filter: { ...s.filter, search } })),
  setState: (state) => set((s) => ({ filter: { ...s.filter, state } })),
  setToday: (today) => set((s) => ({ filter: { ...s.filter, today } })),
  setFrequency: (frequency) => set((s) => ({ filter: { ...s.filter, frequency } })),
  clearFilter: () => set((s) => ({ filter: { ...EMPTY_HABIT_FILTER, state: s.filter.state } })),

  select: (selectedHabitId) => set({ selectedHabitId }),
  open: (openHabitId) => set({ openHabitId }),
  openCreate: () => set({ composer: { mode: 'create' } }),
  openEdit: (habitId) => set({ composer: { mode: 'edit', habitId } }),
  closeComposer: () => set({ composer: { mode: 'closed' } }),
  focusSearch: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),

  reset: () =>
    set({
      filter: EMPTY_HABIT_FILTER,
      selectedHabitId: null,
      openHabitId: null,
      composer: { mode: 'closed' },
    }),
}))
