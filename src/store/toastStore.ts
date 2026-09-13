import { create } from 'zustand'
import { newId } from '@/lib/id'
import type { CommandIntent } from '@/services'

/**
 * Toasts and the undo stack.
 *
 * An undoable action stores the *intent* that reverses it, not a closure. That
 * keeps the store plain data — serialisable, inspectable, and free of any
 * reference to a service — and means the same value can be replayed by a toast
 * button or by ⌘Z minutes later.
 *
 * This is why single-task deletion needs no confirmation dialog: the delete is
 * soft, the reversal is one click, and a modal asking "are you sure?" for
 * something this cheap to undo is just friction.
 */

export type ToastTone = 'neutral' | 'success' | 'danger'

export interface Toast {
  id: string
  message: string
  tone: ToastTone
  action: { label: string; intent: CommandIntent } | null
  /** Milliseconds before it dismisses itself; `null` to require a dismissal. */
  timeout: number | null
}

export interface PushToastInput {
  message: string
  tone?: ToastTone
  action?: { label: string; intent: CommandIntent }
  timeout?: number | null
}

/** How many reversals ⌘Z can walk back through. */
const UNDO_LIMIT = 25
const MAX_VISIBLE = 3

interface ToastState {
  toasts: Toast[]
  /** Most recent reversal first. */
  undoStack: CommandIntent[]
  push: (input: PushToastInput) => string
  dismiss: (id: string) => void
  clear: () => void
  /** Records a reversal without showing anything. */
  pushUndo: (intent: CommandIntent) => void
  /** Removes and returns the most recent reversal. */
  popUndo: () => CommandIntent | undefined
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  undoStack: [],

  push: (input) => {
    const id = newId()
    const toast: Toast = {
      id,
      message: input.message,
      tone: input.tone ?? 'neutral',
      action: input.action ?? null,
      timeout: input.timeout === undefined ? 5000 : input.timeout,
    }
    // Oldest first, capped: a burst of completions must not bury the screen.
    set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_VISIBLE) }))
    return id
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((toast) => toast.id !== id) })),
  clear: () => set({ toasts: [] }),

  pushUndo: (intent) => set((s) => ({ undoStack: [intent, ...s.undoStack].slice(0, UNDO_LIMIT) })),

  popUndo: () => {
    const [next, ...rest] = get().undoStack
    if (!next) return undefined
    set({ undoStack: rest })
    return next
  },
}))
