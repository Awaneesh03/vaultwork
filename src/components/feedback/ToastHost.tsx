import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCommands } from '@/hooks/useCommands'
import { useToasts } from '@/hooks/useToasts'
import type { ToastTone } from '@/store/toastStore'

/**
 * Where every result the command layer returns becomes visible.
 *
 * The action button dispatches an *intent* the result handed over, so this
 * component knows nothing about tasks, deletion, or restoring — it renders a
 * message and replays a value. That is what lets "Task deleted [Undo]" work
 * without a confirmation dialog and without the UI owning any business logic.
 */

const TONES: Record<ToastTone, string> = {
  neutral: 'border-line bg-elevated text-ink',
  success: 'border-line bg-elevated text-ink',
  danger: 'border-danger/40 bg-elevated text-ink',
}

const DOTS: Record<ToastTone, string> = {
  neutral: 'bg-ink-3',
  success: 'bg-ok',
  danger: 'bg-danger',
}

export function ToastHost() {
  const { toasts, dismiss } = useToasts()
  const { dispatch } = useCommands()

  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={cn(
            'pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border px-3.5 py-2.5 shadow-lg',
            'animate-[toast-in_var(--duration-base)_var(--ease-out)]',
            TONES[toast.tone],
          )}
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOTS[toast.tone])} aria-hidden />

          <p className="min-w-0 flex-1 whitespace-pre-line text-strong leading-snug">
            {toast.message}
          </p>

          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                const intent = toast.action?.intent
                dismiss(toast.id)
                if (intent) void dispatch(intent, { notify: 'always' })
              }}
              className="shrink-0 rounded-md px-2 py-1 text-body font-medium text-accent transition-colors hover:bg-accent-soft"
            >
              {toast.action.label}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
