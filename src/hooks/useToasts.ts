import { useEffect, useRef } from 'react'
import { useToastStore, type Toast } from '@/store/toastStore'

export interface ToastController {
  toasts: Toast[]
  dismiss: (id: string) => void
}

/**
 * Reads the toast queue and expires each entry on its own timer.
 *
 * The timer lives here rather than in the store because it is a rendering
 * concern: a toast nobody is displaying does not need to tick.
 */
export function useToasts(): ToastController {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  // One timer per toast, started when it first appears. Re-arming every timer
  // whenever the queue changed meant a steady stream of toasts kept the older
  // ones on screen indefinitely.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const live = new Set(toasts.map((toast) => toast.id))
    for (const [id, timer] of timers.current) {
      if (!live.has(id)) {
        clearTimeout(timer)
        timers.current.delete(id)
      }
    }
    for (const toast of toasts) {
      if (toast.timeout === null || timers.current.has(toast.id)) continue
      timers.current.set(
        toast.id,
        setTimeout(() => {
          timers.current.delete(toast.id)
          dismiss(toast.id)
        }, toast.timeout),
      )
    }
  }, [toasts, dismiss])

  useEffect(() => {
    const owned = timers.current
    return () => {
      owned.forEach(clearTimeout)
      owned.clear()
    }
  }, [])

  return { toasts, dismiss }
}
