import { create } from 'zustand'
import type { DueFilter, EstimateFilter, SortDirection, TaskFilter, TaskSort } from '@/services'
import type { Id } from '@/types/entities'
import type { Priority } from '@/types/enums'

/**
 * Ephemeral state for the task screens: which row is selected, which filters
 * are on, which panel is open.
 *
 * Not one task row lives here. Rows come from Dexie through `useLiveQuery`, so
 * there is exactly one copy of the truth and nothing to keep in step. What is
 * here is the stuff that *should* vanish on refresh.
 */

/** The filter fields the toolbar actually exposes. */
export type ToolbarFilter = Pick<
  TaskFilter,
  'priorities' | 'projectId' | 'tagIds' | 'tagMode' | 'due' | 'hasEstimate' | 'search'
>

export const EMPTY_TOOLBAR_FILTER: ToolbarFilter = {
  priorities: [],
  projectId: 'any',
  tagIds: [],
  tagMode: 'any',
  due: 'any',
  hasEstimate: 'any',
  search: '',
}

interface TaskUiState {
  filter: ToolbarFilter
  /**
   * `null` means "whatever this view opens with". The default lives in the
   * service beside the view definition, not duplicated here.
   */
  sort: TaskSort | null
  direction: SortDirection | null
  /** Rolling window for Upcoming, in days. */
  upcomingDays: number

  /** The row the keyboard is on. */
  selectedTaskId: Id | null
  /** The task whose detail panel is open. */
  openTaskId: Id | null
  quickAddOpen: boolean
  /** Bumped to ask the toolbar's search box to take focus. */
  searchFocusNonce: number

  setSearch: (search: string) => void
  togglePriority: (priority: Priority) => void
  setDue: (due: DueFilter) => void
  setProjectId: (projectId: Id | null | 'any') => void
  toggleTag: (tagId: Id) => void
  setTagMode: (mode: 'any' | 'all') => void
  setHasEstimate: (value: EstimateFilter) => void
  clearFilter: () => void

  setSort: (sort: TaskSort | null, direction?: SortDirection | null) => void
  setUpcomingDays: (days: number) => void

  select: (id: Id | null) => void
  openTask: (id: Id | null) => void
  setQuickAddOpen: (open: boolean) => void
  focusSearch: () => void
  /** Called when a view mounts, so filters do not leak between screens. */
  resetForView: () => void
}

export const useTaskUiStore = create<TaskUiState>((set) => ({
  filter: EMPTY_TOOLBAR_FILTER,
  sort: null,
  direction: null,
  upcomingDays: 14,
  selectedTaskId: null,
  openTaskId: null,
  quickAddOpen: false,
  searchFocusNonce: 0,

  setSearch: (search) => set((s) => ({ filter: { ...s.filter, search } })),

  togglePriority: (priority) =>
    set((s) => ({
      filter: {
        ...s.filter,
        priorities: s.filter.priorities.includes(priority)
          ? s.filter.priorities.filter((value) => value !== priority)
          : [...s.filter.priorities, priority],
      },
    })),

  setDue: (due) => set((s) => ({ filter: { ...s.filter, due } })),
  setProjectId: (projectId) => set((s) => ({ filter: { ...s.filter, projectId } })),

  toggleTag: (tagId) =>
    set((s) => ({
      filter: {
        ...s.filter,
        tagIds: s.filter.tagIds.includes(tagId)
          ? s.filter.tagIds.filter((value) => value !== tagId)
          : [...s.filter.tagIds, tagId],
      },
    })),

  setTagMode: (tagMode) => set((s) => ({ filter: { ...s.filter, tagMode } })),
  setHasEstimate: (hasEstimate) => set((s) => ({ filter: { ...s.filter, hasEstimate } })),
  clearFilter: () => set({ filter: EMPTY_TOOLBAR_FILTER }),

  setSort: (sort, direction = null) => set({ sort, direction }),
  setUpcomingDays: (upcomingDays) => set({ upcomingDays }),

  select: (selectedTaskId) => set({ selectedTaskId }),
  openTask: (openTaskId) => set({ openTaskId }),
  setQuickAddOpen: (quickAddOpen) => set({ quickAddOpen }),
  focusSearch: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),

  resetForView: () =>
    set({
      filter: EMPTY_TOOLBAR_FILTER,
      sort: null,
      direction: null,
      selectedTaskId: null,
      openTaskId: null,
    }),
}))
