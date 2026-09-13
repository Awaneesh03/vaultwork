import { useEffect } from 'react'
import { isDragHandleTarget, isEditableTarget } from '@/hooks/useHotkey'
import type { CalendarMode } from '@/lib/calendar'
import type { DateStr } from '@/types/entities'

/**
 * The calendar's own keyboard layer.
 *
 * Every binding sits behind the same two guards the task and project lists use:
 * nothing fires from inside an input, and nothing fires while dnd-kit is
 * driving a drag with the arrow keys.
 *
 * The bindings were chosen around M3 rather than over it. Lowercase `t`, `u`,
 * `p`, `c`, `n` and `/` already mean something globally, and lowercase `d` and
 * `e` already mean something in a task list — so view switching is **shifted**
 * (`M`, `W`, `D`), and period paging uses the bracket keys, which nothing else
 * claims.
 *
 * "Jump to today" is `Home`, not the conventional `T`: the global layer matches
 * on the lowercased key, so shift+T arrives there as `t` and navigates to the
 * Today task view. M3 keeps that binding; the calendar took a free key instead.
 * No existing shortcut changed meaning to make room for this one.
 */

export interface CalendarShortcutHandlers {
  mode: CalendarMode
  selectedDate: DateStr | null
  /** Moves the selection by whole days. */
  onMoveDays: (delta: number) => void
  onPreviousPeriod: () => void
  onNextPeriod: () => void
  onToday: () => void
  onMode: (mode: CalendarMode) => void
  /** Enter: drill into the selected day. */
  onOpenSelected: () => void
  enabled?: boolean
}

export function useCalendarShortcuts({
  mode,
  selectedDate,
  onMoveDays,
  onPreviousPeriod,
  onNextPeriod,
  onToday,
  onMode,
  onOpenSelected,
  enabled = true,
}: CalendarShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      // Modified keys belong to the global layer (⌘K, ⌘Z) or to the browser.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (isDragHandleTarget(event.target)) return

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          onMoveDays(-1)
          return
        case 'ArrowRight':
          event.preventDefault()
          onMoveDays(1)
          return
        case 'ArrowUp':
          event.preventDefault()
          // A week up in a month grid; the previous day where there is no grid.
          onMoveDays(mode === 'month' ? -7 : -1)
          return
        case 'ArrowDown':
          event.preventDefault()
          onMoveDays(mode === 'month' ? 7 : 1)
          return
        case '[':
          event.preventDefault()
          onPreviousPeriod()
          return
        case ']':
          event.preventDefault()
          onNextPeriod()
          return
        case 'Enter':
          if (selectedDate === null) return
          event.preventDefault()
          onOpenSelected()
          return
        // `Home` rather than the conventional "T": the global layer lowercases
        // its key before matching, so shift+T reaches it as `t` and navigates
        // away to the Today *task view*, unmounting the calendar mid-keystroke.
        // M3 keeps `t`; the calendar takes a key nothing else claims.
        case 'Home':
          event.preventDefault()
          onToday()
          return
        // Shifted, so none of these collide with the global or list layers.
        case 'M':
          event.preventDefault()
          onMode('month')
          return
        case 'W':
          event.preventDefault()
          onMode('week')
          return
        case 'D':
          event.preventDefault()
          onMode('day')
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    enabled,
    mode,
    selectedDate,
    onMoveDays,
    onPreviousPeriod,
    onNextPeriod,
    onToday,
    onMode,
    onOpenSelected,
  ])
}
