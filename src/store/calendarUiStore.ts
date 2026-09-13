import { create } from 'zustand'
import type { CalendarMode } from '@/lib/calendar'
import type { DateStr, Id } from '@/types/entities'
import type { TaskStatusFilter } from '@/services'

/**
 * Ephemeral state for the Calendar: which view, which period, which day.
 *
 * Not one task lives here — rows come from Dexie through `useLiveQuery`, so
 * there is exactly one copy of the truth. What is here is what *should* vanish
 * on refresh, which is the same rule `taskUiStore` and `projectUiStore` follow.
 *
 * The anchor is initialised to `null` rather than to a date: the store has no
 * clock, and guessing "today" with `new Date()` here would be the one place in
 * the application that bypassed the clock port. The screen sets it from the
 * view model's own `today` on first load.
 */

interface CalendarUiState {
  mode: CalendarMode
  /** The date the visible period is built around. `null` until first load. */
  anchor: DateStr | null
  /** The day the keyboard is on, and the one a new task defaults to. */
  selectedDate: DateStr | null
  status: TaskStatusFilter
  /** The day whose full contents are expanded from a month cell overflow. */
  expandedDate: DateStr | null
  /** Set when a task is being dragged, so cells can show a drop affordance. */
  draggingTaskId: Id | null

  setMode: (mode: CalendarMode) => void
  setAnchor: (date: DateStr) => void
  select: (date: DateStr | null) => void
  setStatus: (status: TaskStatusFilter) => void
  expand: (date: DateStr | null) => void
  setDragging: (id: Id | null) => void
  /** Jumps the whole view to a date — used by "Today" and by day selection. */
  goTo: (date: DateStr) => void
  reset: () => void
}

export const useCalendarUiStore = create<CalendarUiState>((set) => ({
  mode: 'month',
  anchor: null,
  selectedDate: null,
  status: 'all',
  expandedDate: null,
  draggingTaskId: null,

  setMode: (mode) => set({ mode, expandedDate: null }),
  setAnchor: (anchor) => set({ anchor }),
  select: (selectedDate) => set({ selectedDate }),
  setStatus: (status) => set({ status }),
  expand: (expandedDate) => set({ expandedDate }),
  setDragging: (draggingTaskId) => set({ draggingTaskId }),

  goTo: (date) => set({ anchor: date, selectedDate: date, expandedDate: null }),

  reset: () =>
    set({
      mode: 'month',
      anchor: null,
      selectedDate: null,
      status: 'all',
      expandedDate: null,
      draggingTaskId: null,
    }),
}))
