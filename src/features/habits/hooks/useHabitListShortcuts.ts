import { useEffect } from 'react'
import { isDragHandleTarget, isEditableTarget } from '@/hooks/useHotkey'
import type { Id } from '@/types/entities'

/**
 * The habit list's own keyboard layer.
 *
 * Behind the same two guards every other list uses: nothing fires from inside
 * an input, and nothing fires while dnd-kit is driving a drag.
 *
 * The bindings mirror the task and project lists deliberately — J/K to move,
 * Enter to open, E to edit, Space to toggle, Backspace to delete — so there is
 * one set of habits to learn across the whole application. Archive is shifted
 * `A`, exactly as it is on the projects screen, because plain `a` is the global
 * jump to Analytics and M3's binding wins.
 */

export interface HabitListShortcutHandlers {
  habitIds: Id[]
  selectedHabitId: Id | null
  onSelect: (id: Id | null) => void
  onOpen: (id: Id) => void
  onToggle: (id: Id) => void
  onEdit: (id: Id) => void
  onArchive: (id: Id) => void
  onDelete: (id: Id) => void
  onEscape: () => void
  enabled?: boolean
}

export function useHabitListShortcuts({
  habitIds,
  selectedHabitId,
  onSelect,
  onOpen,
  onToggle,
  onEdit,
  onArchive,
  onDelete,
  onEscape,
  enabled = true,
}: HabitListShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (isDragHandleTarget(event.target)) return

      const index = selectedHabitId ? habitIds.indexOf(selectedHabitId) : -1
      const selected = index >= 0 ? habitIds[index] : undefined

      const move = (delta: number) => {
        if (habitIds.length === 0) return
        const next = index === -1 ? (delta > 0 ? 0 : habitIds.length - 1) : index + delta
        const clamped = Math.max(0, Math.min(next, habitIds.length - 1))
        const id = habitIds[clamped]
        if (id) onSelect(id)
      }

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          move(1)
          return
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          move(-1)
          return
        case 'Escape':
          event.preventDefault()
          onEscape()
          return
        default:
          break
      }

      if (!selected) return

      switch (event.key) {
        case ' ':
          event.preventDefault()
          onToggle(selected)
          return
        case 'Enter':
          event.preventDefault()
          onOpen(selected)
          return
        case 'e':
          event.preventDefault()
          onEdit(selected)
          return
        case 'A':
          event.preventDefault()
          onArchive(selected)
          return
        case 'Backspace':
        case 'Delete':
        case '#':
          event.preventDefault()
          onDelete(selected)
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    enabled,
    habitIds,
    selectedHabitId,
    onSelect,
    onOpen,
    onToggle,
    onEdit,
    onArchive,
    onDelete,
    onEscape,
  ])
}
