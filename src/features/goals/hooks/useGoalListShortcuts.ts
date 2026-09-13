import { useEffect } from 'react'
import { isDragHandleTarget, isEditableTarget } from '@/hooks/useHotkey'
import type { Id } from '@/types/entities'

/**
 * The goal list's own keyboard layer.
 *
 * Behind the same two guards every other list uses: nothing fires from inside
 * an input, and nothing fires while dnd-kit is driving a drag — without the
 * second, finishing a keyboard drag with Space would also toggle the goal it
 * had just dropped.
 *
 * The bindings mirror the task, project and habit lists deliberately — J/K to
 * move, Enter to open, E to edit, Space to complete, Backspace to delete — so
 * there is one set of habits to learn across the whole application. Archive is
 * shifted `A` because plain `a` is M3's global jump to Analytics, and M3 wins.
 * `M` adds a milestone to the selected goal, which is the one binding this
 * screen adds that no other screen has.
 */

export interface GoalListShortcutHandlers {
  goalIds: Id[]
  selectedGoalId: Id | null
  onSelect: (id: Id | null) => void
  onOpen: (id: Id) => void
  onComplete: (id: Id) => void
  onEdit: (id: Id) => void
  onArchive: (id: Id) => void
  onDelete: (id: Id) => void
  onAddMilestone: (id: Id) => void
  onEscape: () => void
  enabled?: boolean
}

export function useGoalListShortcuts({
  goalIds,
  selectedGoalId,
  onSelect,
  onOpen,
  onComplete,
  onEdit,
  onArchive,
  onDelete,
  onAddMilestone,
  onEscape,
  enabled = true,
}: GoalListShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (isDragHandleTarget(event.target)) return

      const index = selectedGoalId ? goalIds.indexOf(selectedGoalId) : -1
      const selected = index >= 0 ? goalIds[index] : undefined

      const move = (delta: number) => {
        if (goalIds.length === 0) return
        const next = index === -1 ? (delta > 0 ? 0 : goalIds.length - 1) : index + delta
        const clamped = Math.max(0, Math.min(next, goalIds.length - 1))
        const id = goalIds[clamped]
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
          onComplete(selected)
          return
        case 'Enter':
          event.preventDefault()
          onOpen(selected)
          return
        case 'e':
          event.preventDefault()
          onEdit(selected)
          return
        case 'm':
          event.preventDefault()
          onAddMilestone(selected)
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
    goalIds,
    selectedGoalId,
    onSelect,
    onOpen,
    onComplete,
    onEdit,
    onArchive,
    onDelete,
    onAddMilestone,
    onEscape,
  ])
}
