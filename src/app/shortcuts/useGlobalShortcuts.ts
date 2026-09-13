import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCommands } from '@/hooks/useCommands'
import { isEditableTarget } from '@/hooks/useHotkey'
import { useGoalUiStore } from '@/store/goalUiStore'
import { useNoteUiStore } from '@/store/noteUiStore'
import { useHabitUiStore } from '@/store/habitUiStore'
import { useProjectUiStore } from '@/store/projectUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useUiStore } from '@/store/uiStore'
import {
  CAPTURE_ROUTES,
  GOALS_ROUTE,
  NOTES_ROUTE,
  PROJECTS_ROUTE,
  PROJECT_DETAIL_RE,
  ROUTES,
  TASK_ROUTES,
} from '../navigation'

/** Single-key jumps. `g` opens a chord: g then d, i, g, n or o. */
const DIRECT: Record<string, string> = {
  t: '/today',
  u: '/upcoming',
  p: '/projects',
  c: '/calendar',
  f: '/focus',
  a: '/analytics',
  h: '/habits',
}

const CHORD: Record<string, string> = {
  a: '/ai',
  d: '/',
  i: '/inbox',
  g: '/goals',
  n: '/notes',
  o: '/obsidian',
}

const CHORD_TIMEOUT_MS = 1200

/**
 * All global keyboard handling, in one place.
 *
 * Every binding is guarded by `isEditableTarget`, which is the fix for the
 * classic bug in keyboard-driven apps: typing "t" in a title field teleporting
 * you to Today. Guarding once, centrally, means no future feature can
 * reintroduce it.
 *
 * The division of labour with `useTaskListShortcuts`: anything that works
 * anywhere in the app lives here — navigation, quick add, search, undo, escape.
 * Anything that acts on the *selected row* lives with the list. No key is bound
 * in both places, so nothing fires twice.
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate()
  const location = useLocation()
  const toggleCommandPalette = useUiStore((s) => s.toggleCommandPalette)
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const setQuickAddOpen = useTaskUiStore((s) => s.setQuickAddOpen)
  const focusSearch = useTaskUiStore((s) => s.focusSearch)
  const openTask = useTaskUiStore((s) => s.openTask)
  const openProjectComposer = useProjectUiStore((s) => s.openCreate)
  const closeProjectComposer = useProjectUiStore((s) => s.closeComposer)
  const focusProjectSearch = useProjectUiStore((s) => s.focusSearch)
  const openHabitComposer = useHabitUiStore((s) => s.openCreate)
  const closeHabitComposer = useHabitUiStore((s) => s.closeComposer)
  const closeHabitPanel = useHabitUiStore((s) => s.open)
  const focusHabitSearch = useHabitUiStore((s) => s.focusSearch)
  const openGoalComposer = useGoalUiStore((s) => s.openCreate)
  const closeGoalComposer = useGoalUiStore((s) => s.closeComposer)
  const closeMilestoneComposer = useGoalUiStore((s) => s.closeMilestoneComposer)
  const closeGoalPanel = useGoalUiStore((s) => s.open)
  const focusGoalSearch = useGoalUiStore((s) => s.focusSearch)
  const openNoteComposer = useNoteUiStore((s) => s.openComposer)
  const closeNoteComposer = useNoteUiStore((s) => s.closeComposer)
  const focusNoteSearch = useNoteUiStore((s) => s.focusSearch)
  const { undoLast } = useCommands()

  const chordArmed = useRef(false)
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Read through a ref so the listener is not re-bound on every navigation.
  const pathname = useRef(location.pathname)
  pathname.current = location.pathname

  useEffect(() => {
    const disarm = () => {
      chordArmed.current = false
      if (chordTimer.current) clearTimeout(chordTimer.current)
      chordTimer.current = null
    }

    const onTaskScreen = () => (TASK_ROUTES as readonly string[]).includes(pathname.current)
    const onProjectsList = () => pathname.current === PROJECTS_ROUTE
    const onHabits = () => pathname.current === ROUTES.habits
    const onGoals = () => pathname.current === GOALS_ROUTE
    const onNotes = () => pathname.current === NOTES_ROUTE
    const onProjectDetail = () => PROJECT_DETAIL_RE.test(pathname.current)
    /** Anywhere a quick add bar exists. */
    const onCaptureScreen = () =>
      onTaskScreen() ||
      onProjectDetail() ||
      (CAPTURE_ROUTES as readonly string[]).includes(pathname.current)

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggleCommandPalette()
        return
      }

      // Undo works from anywhere except inside a field, where ⌘Z belongs to
      // the browser's own text undo.
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        if (isEditableTarget(event.target)) return
        event.preventDefault()
        void undoLast()
        return
      }

      if (isEditableTarget(event.target) || event.altKey || mod) return

      // Shift+N captures a note from anywhere, with no route change. Checked
      // before the key is lower-cased, or it would be indistinguishable from
      // the plain "n" that captures a task.
      if (event.shiftKey && event.key === 'N') {
        event.preventDefault()
        openNoteComposer()
        return
      }

      const key = event.key.toLowerCase()

      if (key === 'escape') {
        disarm()
        setCommandPaletteOpen(false)
        openTask(null)
        setQuickAddOpen(false)
        closeProjectComposer()
        closeHabitComposer()
        closeHabitPanel(null)
        // The milestone composer sits above the goal panel, so it closes first
        // in reading order — both are cleared, since Escape here is "dismiss
        // whatever is open" rather than a stack pop.
        closeMilestoneComposer()
        closeGoalComposer()
        closeGoalPanel(null)
        closeNoteComposer()
        return
      }

      if (chordArmed.current) {
        const target = CHORD[key]
        disarm()
        if (target) {
          event.preventDefault()
          navigate(target)
        }
        return
      }

      if (key === 'g') {
        event.preventDefault()
        chordArmed.current = true
        chordTimer.current = setTimeout(disarm, CHORD_TIMEOUT_MS)
        return
      }

      // N captures. What it captures depends on where you are: on the projects
      // list the obvious new thing is a project, and teleporting to Today
      // instead — which is what an unqualified "go somewhere with a quick add
      // bar" rule would do — throws away the screen you were looking at.
      if (key === 'n') {
        event.preventDefault()
        if (onProjectsList()) {
          openProjectComposer()
          return
        }
        if (onHabits()) {
          openHabitComposer()
          return
        }
        if (onGoals()) {
          openGoalComposer()
          return
        }
        setQuickAddOpen(true)
        if (!onCaptureScreen()) navigate('/today')
        return
      }

      if (key === '/') {
        event.preventDefault()
        if (onProjectsList()) {
          focusProjectSearch()
          return
        }
        if (onHabits()) {
          focusHabitSearch()
          return
        }
        if (onGoals()) {
          focusGoalSearch()
          return
        }
        if (onNotes()) {
          focusNoteSearch()
          return
        }
        if (!onCaptureScreen()) navigate('/tasks')
        focusSearch()
        return
      }

      const direct = DIRECT[key]
      if (direct) {
        event.preventDefault()
        navigate(direct)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      disarm()
    }
  }, [
    navigate,
    toggleCommandPalette,
    setCommandPaletteOpen,
    setQuickAddOpen,
    focusSearch,
    openTask,
    openProjectComposer,
    closeProjectComposer,
    focusProjectSearch,
    openHabitComposer,
    closeHabitComposer,
    closeHabitPanel,
    focusHabitSearch,
    openGoalComposer,
    closeGoalComposer,
    closeMilestoneComposer,
    closeGoalPanel,
    focusGoalSearch,
    openNoteComposer,
    closeNoteComposer,
    focusNoteSearch,
    undoLast,
  ])
}
