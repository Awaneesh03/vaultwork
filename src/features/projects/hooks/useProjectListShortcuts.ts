import { useEffect } from 'react'
import { isDragHandleTarget, isEditableTarget } from '@/hooks/useHotkey'
import type { Id, Project } from '@/types/entities'

/**
 * The project list's own keyboard layer.
 *
 * Every handler sits behind `isEditableTarget`, the same guard the global
 * shortcuts and the task list use. That single rule is what keeps a
 * keyboard-driven app usable: typing "e" into a project name must never open
 * the editor, and typing "a" must never archive something.
 *
 * The bindings mirror the task list's on purpose — J/K to move, Enter to open,
 * E to edit, Backspace to delete — so there is one set of habits to learn
 * rather than two. `isDragHandleTarget` is the second guard: while a drag grip
 * has focus, space and the arrows belong to dnd-kit, not to this layer.
 */

export interface ProjectListShortcutHandlers {
  projects: Project[]
  selectedProjectId: Id | null
  onSelect: (id: Id | null) => void
  onOpen: (project: Project) => void
  onEdit: (project: Project) => void
  onArchive: (project: Project) => void
  onDelete: (project: Project) => void
  onEscape: () => void
  enabled?: boolean
}

export function useProjectListShortcuts({
  projects,
  selectedProjectId,
  onSelect,
  onOpen,
  onEdit,
  onArchive,
  onDelete,
  onEscape,
  enabled = true,
}: ProjectListShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      // Modified keys belong to the global layer (⌘K, ⌘Z) or to the browser.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      // Space and the arrows belong to dnd-kit while a grip has focus, or the
      // keypress that drops a row would also open it.
      if (isDragHandleTarget(event.target)) return

      const index = selectedProjectId
        ? projects.findIndex((project) => project.id === selectedProjectId)
        : -1
      const selected = index >= 0 ? projects[index] : undefined

      const move = (delta: number) => {
        if (projects.length === 0) return
        const next = index === -1 ? (delta > 0 ? 0 : projects.length - 1) : index + delta
        const clamped = Math.max(0, Math.min(next, projects.length - 1))
        const project = projects[clamped]
        if (project) onSelect(project.id)
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
        case 'Enter':
        case ' ':
          event.preventDefault()
          onOpen(selected)
          return
        case 'e':
          event.preventDefault()
          onEdit(selected)
          return
        // Shifted, unlike the task list's plain keys: archiving is a
        // structural change, and "a" is already the global jump to Analytics.
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
    projects,
    selectedProjectId,
    onSelect,
    onOpen,
    onEdit,
    onArchive,
    onDelete,
    onEscape,
  ])
}
