import { useEffect } from 'react'
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

  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.timeout !== null)
      .map((toast) => setTimeout(() => dismiss(toast.id), toast.timeout ?? 0))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])

  return { toasts, dismiss }
}
