import { create } from 'zustand'
import type { ProjectProgressFilter, ProjectSort, ProjectStateFilter } from '@/services'
import type { Id } from '@/types/entities'
import type { ProjectStatus } from '@/types/enums'

/**
 * Ephemeral state for the Projects screens: which filters are on, which row the
 * keyboard is on, whether the composer is open.
 *
 * Not one project row lives here — rows come from Dexie through `useLiveQuery`,
 * so there is exactly one copy of the truth. What is here is the stuff that
 * *should* vanish on refresh. Same rule as `taskUiStore`.
 */

export interface ProjectToolbarFilter {
  state: ProjectStateFilter
  progress: ProjectProgressFilter
  status: ProjectStatus | 'any'
  search: string
}

export const EMPTY_PROJECT_FILTER: ProjectToolbarFilter = {
  state: 'active',
  progress: 'any',
  status: 'any',
  search: '',
}

/**
 * The composer is one piece of state, not three booleans.
 *
 * `{ mode: 'edit', projectId }` cannot be open without a project, and
 * `{ mode: 'create' }` cannot carry a stale id from the last edit — both of
 * which are possible with an `open` flag and a separate id.
 */
export type ComposerState =
  { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; projectId: Id }

interface ProjectUiState {
  filter: ProjectToolbarFilter
  sort: ProjectSort
  /** The row the keyboard is on. */
  selectedProjectId: Id | null
  composer: ComposerState
  /** The project whose task picker is open. */
  pickerProjectId: Id | null
  /** Bumped to ask the toolbar's search box to take focus. */
  searchFocusNonce: number

  setSearch: (search: string) => void
  setState: (state: ProjectStateFilter) => void
  setProgress: (progress: ProjectProgressFilter) => void
  setStatus: (status: ProjectStatus | 'any') => void
  setSort: (sort: ProjectSort) => void
  clearFilter: () => void

  select: (id: Id | null) => void
  openCreate: () => void
  openEdit: (projectId: Id) => void
  closeComposer: () => void
  openPicker: (projectId: Id) => void
  closePicker: () => void
  focusSearch: () => void
  /** Called when the Projects screen mounts, so filters do not leak in. */
  resetForView: () => void
}

export const useProjectUiStore = create<ProjectUiState>((set) => ({
  filter: EMPTY_PROJECT_FILTER,
  sort: 'manual',
  selectedProjectId: null,
  composer: { mode: 'closed' },
  pickerProjectId: null,
  searchFocusNonce: 0,

  setSearch: (search) => set((s) => ({ filter: { ...s.filter, search } })),
  setState: (state) => set((s) => ({ filter: { ...s.filter, state } })),
  setProgress: (progress) => set((s) => ({ filter: { ...s.filter, progress } })),
  setStatus: (status) => set((s) => ({ filter: { ...s.filter, status } })),
  setSort: (sort) => set({ sort }),
  clearFilter: () => set((s) => ({ filter: { ...EMPTY_PROJECT_FILTER, state: s.filter.state } })),

  select: (selectedProjectId) => set({ selectedProjectId }),
  openCreate: () => set({ composer: { mode: 'create' } }),
  openEdit: (projectId) => set({ composer: { mode: 'edit', projectId } }),
  closeComposer: () => set({ composer: { mode: 'closed' } }),
  openPicker: (pickerProjectId) => set({ pickerProjectId }),
  closePicker: () => set({ pickerProjectId: null }),
  focusSearch: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),

  resetForView: () =>
    set({
      filter: EMPTY_PROJECT_FILTER,
      sort: 'manual',
      selectedProjectId: null,
      composer: { mode: 'closed' },
      pickerProjectId: null,
    }),
}))
