import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

/**
 * Focus handling for a modal dialog: the three things every hand-built dialog
 * here was missing.
 *
 *  1. On open, focus moves inside — unless something inside already took it
 *     (an `autoFocus` field wins). A dialog that leaves focus behind it cannot
 *     hear its own Escape key.
 *  2. Tab and Shift+Tab cycle within it instead of wandering into the page
 *     behind the backdrop.
 *  3. On close, focus returns to whatever opened it, rather than to <body>.
 *
 * Attach the returned ref to the element with `role="dialog"`, and give that
 * element `tabIndex={-1}` so it can hold focus itself when it has no controls.
 * Pass `open` when the component stays mounted while the dialog is hidden.
 */
export function useDialogFocus<T extends HTMLElement>(open = true) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const node = ref.current
    if (!open || !node) return
    const before = document.activeElement
    const opener = before instanceof HTMLElement && !node.contains(before) ? before : null

    if (!node.contains(document.activeElement)) {
      ;(node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) {
        event.preventDefault()
        return
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    node.addEventListener('keydown', onKeyDown)

    return () => {
      node.removeEventListener('keydown', onKeyDown)
      // Only if focus is still ours to give back: a dialog that closed because
      // the user clicked elsewhere must not yank focus away from that click.
      const active = document.activeElement
      if (
        opener?.isConnected &&
        (active === null || active === document.body || node.contains(active))
      ) {
        opener.focus()
      }
    }
  }, [open])

  return ref
}
