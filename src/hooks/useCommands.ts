import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { execute, parseCommand, resolveChoice } from '@/services'
import type { CommandIntent, CommandResult } from '@/services'
import { useToastStore } from '@/store/toastStore'
import type { Id } from '@/types/entities'
import type { EventSource } from '@/types/enums'

/**
 * The only way a component starts a task mutation.
 *
 * Components render and dispatch intents; this hook is the seam where an
 * intent meets the command layer, and where a CommandResult turns into the
 * three things a UI owes the user: a visible change, a message, and a way back.
 *
 * Nothing above this file imports `taskService`, and nothing at all above
 * `services/` imports `taskRepo`. That is what makes Telegram a new *producer*
 * in M14 rather than a second implementation of everything below.
 */

export type AmbiguousResult = Extract<CommandResult, { status: 'ambiguous' }>

/** How loudly to report a result. */
export type NotifyMode = 'auto' | 'always' | 'errors'

export interface DispatchOptions {
  notify?: NotifyMode
  /**
   * The project a bare capture belongs to. Only `run` reads it — `dispatch`
   * receives an intent the caller has already built.
   */
  defaultProjectId?: Id | null
}

export interface CommandController {
  dispatch: (intent: CommandIntent, options?: DispatchOptions) => Promise<CommandResult>
  /** Text in — the Quick Add and palette path. */
  run: (text: string, source?: EventSource, options?: DispatchOptions) => Promise<CommandResult>
  /** Replays the most recent reversible action. Bound to ⌘Z. */
  undoLast: () => Promise<CommandResult | null>
  canUndo: boolean
  /** Set when a text reference matched several tasks. */
  ambiguity: AmbiguousResult | null
  resolve: (id: Id) => Promise<CommandResult>
  clearAmbiguity: () => void
  pending: boolean
}

/** Intent kinds whose reversal belongs on the ⌘Z stack. */
const DESTRUCTIVE = new Set<CommandIntent['kind']>([
  'task.delete',
  'subtask.delete',
  'project.delete',
  'project.archive',
  'habit.delete',
  'habit.archive',
  'goal.delete',
  'goal.archive',
  'milestone.delete',
  'note.delete',
])

/** Result kinds that carry a row and can therefore carry an undo with it. */
function undoableResult(
  result: CommandResult,
): Extract<
  CommandResult,
  { kind: 'task' | 'subtask' | 'project' | 'habit' | 'goal' | 'milestone' | 'note' }
> | null {
  if (result.status !== 'ok') return null
  if (
    result.kind === 'task' ||
    result.kind === 'subtask' ||
    result.kind === 'project' ||
    result.kind === 'habit' ||
    result.kind === 'goal' ||
    result.kind === 'milestone' ||
    result.kind === 'note'
  ) {
    return result
  }
  return null
}

/**
 * Whether a successful result deserves a toast.
 *
 * A completion clicked in a list needs none — the row visibly changes, and a
 * toast per keystroke would be noise. A command typed into the palette needs
 * one, because nothing else confirms it happened.
 */
function shouldAnnounce(intent: CommandIntent, result: CommandResult): boolean {
  if (result.status !== 'ok') return true
  if (result.kind === 'view' || result.kind === 'navigate' || result.kind === 'help') return false
  if (DESTRUCTIVE.has(intent.kind)) return true
  // A project mutation has no visible row to change under the cursor the way a
  // task checkbox does, so it always says what it did.
  if (result.kind === 'project') return true
  // A habit tick *does* visibly change its own row, so it stays quiet; the
  // structural changes announce themselves.
  if (result.kind === 'habit') return intent.kind !== 'habit.toggle'
  // A goal mutation is structural and rarely has a row visibly changing under
  // the cursor, so it always says what it did — and in particular says that
  // completing a goal left the tasks alone.
  if (result.kind === 'goal') return true
  // A milestone checkbox visibly ticks itself; the structural changes speak up.
  if (result.kind === 'milestone') return intent.kind !== 'milestone.toggle'
  // A note autosaves constantly. Announcing every save would be a toast every
  // 500 ms while somebody types; the editor shows its own saved indicator, so
  // only the structural changes speak up.
  if (result.kind === 'note') return intent.kind !== 'note.update'
  if (intent.source === 'quickadd' || intent.source === 'palette') return true
  return false
}

export function useCommands(): CommandController {
  const navigate = useNavigate()
  const push = useToastStore((s) => s.push)
  const pushUndo = useToastStore((s) => s.pushUndo)
  const popUndo = useToastStore((s) => s.popUndo)
  const canUndo = useToastStore((s) => s.undoStack.length > 0)

  const [ambiguity, setAmbiguity] = useState<AmbiguousResult | null>(null)
  const [pending, setPending] = useState(false)

  const handle = useCallback(
    (intent: CommandIntent, result: CommandResult, notify: NotifyMode) => {
      if (result.status === 'ambiguous') {
        setAmbiguity(result)
        return
      }
      setAmbiguity(null)

      if (result.status === 'ok' && (result.kind === 'view' || result.kind === 'navigate')) {
        navigate(result.path)
      }

      const undoable = undoableResult(result)
      if (undoable && DESTRUCTIVE.has(intent.kind) && undoable.undo) {
        pushUndo(undoable.undo)
      }

      const announce =
        notify === 'always' ||
        (notify === 'errors' && result.status !== 'ok') ||
        (notify === 'auto' && shouldAnnounce(intent, result))

      if (!announce) return

      const undo = undoable?.undo ?? null

      push({
        message: result.message,
        tone: result.status === 'ok' ? 'success' : 'danger',
        ...(undo ? { action: { label: 'Undo', intent: undo } } : {}),
      })
    },
    [navigate, push, pushUndo],
  )

  const dispatch = useCallback(
    async (intent: CommandIntent, options: DispatchOptions = {}) => {
      setPending(true)
      try {
        const result = await execute(intent)
        handle(intent, result, options.notify ?? 'auto')
        return result
      } finally {
        setPending(false)
      }
    },
    [handle],
  )

  const run = useCallback(
    async (text: string, source: EventSource = 'ui', options: DispatchOptions = {}) => {
      setPending(true)
      try {
        // Parsed once, then executed: `executeText` would parse a second time.
        const intent = parseCommand(text, {
          source,
          ...(options.defaultProjectId == null
            ? {}
            : { defaultProjectId: options.defaultProjectId }),
        })
        const result = await execute(intent)
        handle(intent, result, options.notify ?? 'auto')
        return result
      } finally {
        setPending(false)
      }
    },
    [handle],
  )

  const resolve = useCallback(
    async (id: Id) => {
      if (!ambiguity) throw new Error('Nothing is waiting to be resolved')
      setPending(true)
      try {
        const result = await resolveChoice(ambiguity.intent, id)
        handle(ambiguity.intent, result, 'always')
        return result
      } finally {
        setPending(false)
      }
    },
    [ambiguity, handle],
  )

  const undoLast = useCallback(async () => {
    const intent = popUndo()
    if (!intent) return null
    const result = await execute(intent)
    push({
      message: result.message,
      tone: result.status === 'ok' ? 'success' : 'danger',
    })
    return result
  }, [popUndo, push])

  return {
    dispatch,
    run,
    undoLast,
    canUndo,
    ambiguity,
    resolve,
    clearAmbiguity: () => setAmbiguity(null),
    pending,
  }
}
