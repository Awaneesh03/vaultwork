import { useEffect, useRef } from 'react'

export interface HotkeyOptions {
  enabled?: boolean
  /** Off by default: typing "t" in a title box must not navigate to Today. */
  allowInInput?: boolean
  preventDefault?: boolean
}

/**
 * True when the event came from a drag handle mid-drag.
 *
 * dnd-kit's `KeyboardSensor` drives a drag with space and the arrow keys — the
 * same keys the list layers bind to "move the selection" and "activate the
 * selected row". Without this guard a keyboard drag does two things at once:
 * the arrows move both the dragged row *and* the selection, and the space that
 * drops the row also activates whatever ended up selected, so finishing a drag
 * navigates away from the list you were sorting.
 *
 * dnd-kit stamps `aria-roledescription` on every activator it owns — "sortable"
 * for a reorderable list, "draggable" for a free drag such as the calendar's —
 * so "this key belongs to a drag" is answerable from the event alone, and no
 * drag state has to be lifted out of a view and threaded into the keyboard
 * layer.
 */
const DRAG_ACTIVATOR = '[aria-roledescription="sortable"], [aria-roledescription="draggable"]'

export function isDragHandleTarget(target: EventTarget | null): boolean {
  // `Element`, not `HTMLElement`: the grip contains an <svg> icon, and an
  // SVGElement is not an HTMLElement.
  if (!(target instanceof Element)) return false
  return target.closest(DRAG_ACTIVATOR) !== null
}

/** True when the event came from somewhere the user is typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  )
}

/** Normalises an event to "k", "mod+k", "shift+f". */
export function eventToCombo(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey && event.key.length > 1) parts.push('shift')
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
  parts.push(key)
  return parts.join('+')
}

/**
 * Binds one or more key combinations to a handler for as long as the component
 * is mounted. Every single-key binding in the app goes through here, so the
 * "ignore events from inputs" rule is written once instead of eleven times.
 */
export function useHotkey(
  combos: string | string[],
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  const { enabled = true, allowInInput = false, preventDefault = true } = options
  const list = Array.isArray(combos) ? combos : [combos]
  const key = list.join('|')

  useEffect(() => {
    if (!enabled) return
    const wanted = new Set(key.split('|'))

    const onKeyDown = (event: KeyboardEvent) => {
      if (!allowInInput && isEditableTarget(event.target)) return
      if (!wanted.has(eventToCombo(event))) return
      if (preventDefault) event.preventDefault()
      handlerRef.current(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, enabled, allowInInput, preventDefault])
}
