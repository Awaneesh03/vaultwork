import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Debounced autosave.
 *
 * There is no save button, so this is the only thing standing between a user's
 * typing and their work existing. Three failure modes it is built to avoid:
 *
 *  1. **Losing the last keystrokes.** A debounce that only fires on a timer
 *     drops whatever was typed in the final 500 ms if the component unmounts —
 *     navigating away from a note would silently discard the end of it. So the
 *     pending value is flushed on unmount, and the flush reads a ref rather
 *     than a captured closure so it always sees the latest text.
 *
 *  2. **Saving what was never changed.** The timer only starts when the value
 *     actually differs from what was last saved, so opening a note and reading
 *     it writes nothing at all.
 *
 *  3. **Saving into the wrong note.** Switching notes resets the baseline; a
 *     pending timer from the previous note is cancelled rather than allowed to
 *     land on the new one.
 */

export const AUTOSAVE_DELAY_MS = 500

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface Autosave<T> {
  /** Records a new value and (re)starts the debounce. */
  change: (value: T) => void
  /** Writes any pending value immediately — used on blur and on unmount. */
  flush: () => void
  state: SaveState
}

export function useAutosave<T>(
  /** Changes identity when the *subject* changes, e.g. a note id. */
  key: string | null,
  initial: T,
  save: (value: T) => Promise<unknown>,
  equal: (a: T, b: T) => boolean = Object.is,
  delay: number = AUTOSAVE_DELAY_MS,
): Autosave<T> {
  const [state, setState] = useState<SaveState>('idle')

  // Refs, not state: the flush on unmount must see the newest value, and a
  // captured closure would see whatever was current when the effect last ran.
  const pending = useRef<T | null>(null)
  const saved = useRef<T>(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)
  const equalRef = useRef(equal)
  const activeKey = useRef(key)

  saveRef.current = save
  equalRef.current = equal

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  // A new subject means a new baseline. Anything still pending belonged to the
  // previous note and must not be written into this one.
  useEffect(() => {
    cancel()
    pending.current = null
    saved.current = initial
    activeKey.current = key
    setState('idle')
    // `initial` is intentionally not a dependency: it changes identity on every
    // live-query tick, and re-baselining on that would fight the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const write = useCallback(async () => {
    const value = pending.current
    if (value === null) return
    pending.current = null

    setState('saving')
    try {
      await saveRef.current(value)
      saved.current = value
      setState('saved')
    } catch {
      // The value stays pending so a later flush can retry it rather than
      // dropping the user's text on the floor.
      pending.current = value
      setState('error')
    }
  }, [])

  const change = useCallback(
    (value: T) => {
      if (equalRef.current(value, saved.current)) {
        // Typing back to the saved text is not a change; cancel the write so an
        // undo-to-original does not append an event.
        cancel()
        pending.current = null
        setState((current) => (current === 'pending' ? 'idle' : current))
        return
      }

      pending.current = value
      setState('pending')
      cancel()
      timer.current = setTimeout(() => {
        timer.current = null
        void write()
      }, delay)
    },
    [delay, write],
  )

  const flush = useCallback(() => {
    cancel()
    void write()
  }, [write])

  // The unmount flush. Without it, navigating away within the debounce window
  // loses whatever was typed last.
  useEffect(
    () => () => {
      cancel()
      if (pending.current !== null) void saveRef.current(pending.current)
    },
    [],
  )

  return { change, flush, state }
}
