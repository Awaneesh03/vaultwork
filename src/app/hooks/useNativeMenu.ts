import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { platform, type MenuAction } from '@/platform'
import { useCommands } from '@/hooks/useCommands'
import { isEditableTarget } from '@/hooks/useHotkey'
import { useNoteUiStore } from '@/store/noteUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useUiStore } from '@/store/uiStore'

/**
 * The native menu bar, connected to what the application already does.
 *
 * Every item here maps onto an action that exists for a keyboard user too:
 * "New Note" opens the same composer Shift+N does, "Tasks" goes to the same
 * route the sidebar does. That is the rule the menu is built on — a menu item
 * is a second *entrance* to an action, never a second *implementation* of it.
 *
 * Export and Import are the one indirection. Their implementation lives in the
 * settings screen (it owns the file input and the progress state), so the menu
 * navigates there and leaves a request in the ephemeral UI store for that
 * screen to pick up. The alternative — reaching into the backup service from
 * here — would mean two call sites for the same operation.
 *
 * Undo is the one item that has to make a decision, and it is a decision the
 * browser already makes. On macOS a menu item's key equivalent wins before the
 * key event reaches the WebView, so Cmd+Z arrives here rather than at
 * `useGlobalShortcuts`. The rule is therefore applied here instead — using the
 * same `isEditableTarget` predicate and the same `undoLast` command — so the
 * two runtimes cannot disagree about when Cmd+Z belongs to your typing and
 * when it belongs to your tasks.
 *
 * In a browser this hook subscribes to a port that never fires, `useGlobalShortcuts`
 * keeps handling Cmd+Z exactly as it did before, and the cost is one resolved
 * promise at mount.
 */
export function useNativeMenu(): void {
  const navigate = useNavigate()
  const setQuickAddOpen = useTaskUiStore((s) => s.setQuickAddOpen)
  const openNoteComposer = useNoteUiStore((s) => s.openComposer)
  const requestMenuAction = useUiStore((s) => s.requestMenuAction)
  const { undoLast } = useCommands()

  useEffect(() => {
    if (!platform.menu.isSupported) return

    let unsubscribe: (() => void) | null = null
    let cancelled = false

    const perform = (action: MenuAction) => {
      switch (action) {
        case 'settings':
          navigate('/settings')
          return
        case 'new-task':
          setQuickAddOpen(true)
          return
        case 'new-note':
          openNoteComposer()
          return
        case 'undo':
          /*
           * Whose undo is this?
           *
           * If the caret is in a field, the answer is the field's — undoing a
           * task while somebody is mid-sentence would be startling and hard to
           * reverse. `document.execCommand('undo')` reaches WebKit's own
           * editing undo, which is the identical code path the predefined
           * macOS menu item used to invoke, so text editing behaves exactly as
           * it did before this item became custom.
           *
           * Otherwise it is the application's, and it is the *existing* undo:
           * `undoLast` pops the same stack the Undo toast pops.
           */
          if (isEditableTarget(document.activeElement)) {
            document.execCommand('undo')
            return
          }
          void undoLast()
          return
        case 'export':
        case 'import':
          navigate('/settings')
          requestMenuAction(action)
          return
        case 'go-dashboard':
          navigate('/')
          return
        case 'go-tasks':
          navigate('/tasks')
          return
        case 'go-calendar':
          navigate('/calendar')
          return
        case 'go-notes':
          navigate('/notes')
          return
      }
    }

    void platform.menu.subscribe(perform).then((off) => {
      // The subscription resolves asynchronously, so a component that unmounts
      // first would otherwise leak a listener into the next mount.
      if (cancelled) off()
      else unsubscribe = off
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [navigate, setQuickAddOpen, openNoteComposer, requestMenuAction, undoLast])
}
