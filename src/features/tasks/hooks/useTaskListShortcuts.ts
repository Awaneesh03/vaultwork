import { useEffect } from 'react'
import { isDragHandleTarget, isEditableTarget } from '@/hooks/useHotkey'
import type { Id, Task } from '@/types/entities'
import { PRIORITIES, type Priority } from '@/types/enums'

/**
 * The list's own keyboard layer.
 *
 * Every handler is behind `isEditableTarget`, the same guard the global
 * shortcuts use. That is the single rule that keeps a keyboard-driven app
 * usable: typing "e" into a task title must never open the editor, and typing
 * "1" must never change a priority. Guarding centrally means no future feature
 * can reintroduce the bug by forgetting.
 *
 * These bindings all act on the *selected row*. Anything that works anywhere in
 * the app — N, /, ⌘K, ⌘Z — lives in `useGlobalShortcuts` instead, so no key is
 * handled by two listeners. `isDragHandleTarget` extends the same rule to the
 * drag grips: while one has focus, space and the arrows are dnd-kit's.
 */

/** 1–4, urgent first — the order they read in the composer. */
const PRIORITY_BY_DIGIT: Record<string, Priority> = {
  '1': 'urgent',
  '2': 'high',
  '3': 'medium',
  '4': 'low',
}

export interface TaskListShortcutHandlers {
  tasks: Task[]
  selectedTaskId: Id | null
  onSelect: (id: Id | null) => void
  onToggle: (task: Task) => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onPriority: (task: Task, priority: Priority) => void
  onSchedule: (task: Task) => void
  onFocus: (task: Task) => void
  onEscape: () => void
  enabled?: boolean
}

export function useTaskListShortcuts({
  tasks,
  selectedTaskId,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  onPriority,
  onSchedule,
  onFocus,
  onEscape,
  enabled = true,
}: TaskListShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      // Modified keys belong to the global layer (⌘K, ⌘Z) or to the browser.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      // Space and the arrows belong to dnd-kit while a grip has focus.
      if (isDragHandleTarget(event.target)) return

      const key = event.key
      const index = selectedTaskId ? tasks.findIndex((task) => task.id === selectedTaskId) : -1
      const selected = index >= 0 ? tasks[index] : undefined

      const move = (delta: number) => {
        if (tasks.length === 0) return
        const next = index === -1 ? (delta > 0 ? 0 : tasks.length - 1) : index + delta
        const clamped = Math.max(0, Math.min(next, tasks.length - 1))
        const task = tasks[clamped]
        if (task) onSelect(task.id)
      }

      switch (key) {
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

      if (key === ' ') {
        event.preventDefault()
        onToggle(selected)
        return
      }

      if (key === 'e' || key === 'Enter') {
        event.preventDefault()
        onEdit(selected)
        return
      }

      if (key === 'd') {
        event.preventDefault()
        onSchedule(selected)
        return
      }

      if (key === '#' || key === 'Backspace' || key === 'Delete') {
        event.preventDefault()
        onDelete(selected)
        return
      }

      if (key === 'F') {
        event.preventDefault()
        onFocus(selected)
        return
      }

      const priority = PRIORITY_BY_DIGIT[key]
      if (priority && PRIORITIES.includes(priority)) {
        event.preventDefault()
        onPriority(selected, priority)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    enabled,
    tasks,
    selectedTaskId,
    onSelect,
    onToggle,
    onEdit,
    onDelete,
    onPriority,
    onSchedule,
    onFocus,
    onEscape,
  ])
}
