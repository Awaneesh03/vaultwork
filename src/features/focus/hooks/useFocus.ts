import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { platform } from '@/platform'
import {
  cancelFocus,
  completeFocus,
  FocusAlreadyRunningError,
  getActiveFocus,
  listFocusHistory,
  plannedMinutesFor,
  remainingMs,
  startFocus,
  type StartFocusInput,
} from '@/services'
import type { FocusSession } from '@/types/entities'
import type { FocusKind } from '@/types/enums'

/**
 * The Pomodoro timer, as a component sees it.
 *
 * One interval, and only while something is actually running. The countdown is
 * *derived* from the session's own `startedAt` and `plannedMin` rather than
 * counted down in state, so the tick exists only to re-render — if it fires
 * late, early, or not at all, the number shown is still right. A reload
 * mid-session picks the session back up from Dexie and the remaining time is
 * unchanged.
 *
 * That distinction matters for the failure this hook is written to avoid: a
 * timer that *is* the state can be started twice, drift while backgrounded, and
 * leave a stale interval writing to an unmounted component. A timer that merely
 * re-renders derived arithmetic cannot.
 */

export interface FocusController {
  /** `undefined` while the first query is in flight — `useLiveQuery`'s signal. */
  active: FocusSession | null | undefined
  history: FocusSession[] | undefined
  /** Milliseconds left in the running session, or null when nothing runs. */
  remaining: number | null
  /** True while the running session has passed its planned end. */
  overrun: boolean
  busy: boolean
  error: string | null

  start: (input?: StartFocusInput) => Promise<void>
  complete: () => Promise<void>
  cancel: () => Promise<void>
  plannedFor: (kind: FocusKind) => Promise<number>
}

const TICK_MS = 1000

export function useFocus(): FocusController {
  const active = useLiveQuery(() => getActiveFocus(), [], undefined)
  const history = useLiveQuery(() => listFocusHistory(), [], undefined)

  const [now, setNow] = useState(() => platform.clock.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Guards against a second write for the same finish.
   *
   * The tick and a click can both notice the same expiry. Keyed by session id
   * so a *new* session can still auto-complete after an old one did.
   */
  const completing = useRef<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /*
   * The only timer in the feature.
   *
   * Started when a session begins and torn down when it ends or the screen
   * unmounts, so there is never more than one and never one without a session
   * behind it. `active?.id` rather than `active` in the dependencies: a live
   * query hands back a fresh object on every emission, and depending on the
   * object would tear the interval down and rebuild it every second.
   */
  const activeId = active?.id ?? null
  useEffect(() => {
    if (activeId === null) return
    setNow(platform.clock.now())
    const handle = setInterval(() => {
      if (alive.current) setNow(platform.clock.now())
    }, TICK_MS)
    return () => clearInterval(handle)
  }, [activeId])

  const remaining = active ? remainingMs(active, now) : null

  /*
   * Finishing when the time runs out.
   *
   * In an effect rather than inside the tick, so the write is driven by state
   * the component has actually rendered, and guarded by `completing` so the
   * several renders that can observe zero produce one write between them.
   */
  useEffect(() => {
    if (!active || remaining === null || remaining > 0) return
    if (completing.current === active.id) return

    completing.current = active.id
    void completeFocus(active.id).catch(() => {
      // A failed auto-finish must not wedge the session: let the next tick, or
      // the user's own button, try again.
      completing.current = null
    })
  }, [active, remaining])

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    if (!alive.current) return
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (thrown) {
      if (!alive.current) return
      setError(
        thrown instanceof FocusAlreadyRunningError
          ? 'A session is already running.'
          : thrown instanceof Error
            ? thrown.message
            : 'That did not work.',
      )
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  const start = useCallback(
    async (input: StartFocusInput = {}) => {
      // The service refuses a second session anyway; this stops the request
      // being made at all while one is in flight.
      if (busy) return
      await run(() => startFocus(input))
    },
    [busy, run],
  )

  const complete = useCallback(async () => {
    if (!active) return
    await run(() => completeFocus(active.id))
  }, [active, run])

  const cancel = useCallback(async () => {
    if (!active) return
    await run(() => cancelFocus(active.id))
  }, [active, run])

  return {
    active,
    history,
    remaining,
    overrun: remaining === 0 && Boolean(active),
    busy,
    error,
    start,
    complete,
    cancel,
    plannedFor: plannedMinutesFor,
  }
}
