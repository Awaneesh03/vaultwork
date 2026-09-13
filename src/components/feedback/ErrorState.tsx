import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/**
 * An error tells you what went wrong and what to do about it. No apologies, no
 * "something went wrong".
 */
export function ErrorState({
  title = 'That did not work',
  error,
  onRetry,
}: {
  title?: string
  error: Error
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle size={16} aria-hidden />
        <p className="text-strong font-medium">{title}</p>
      </div>
      <p className="font-mono text-body leading-relaxed text-ink-2">{error.message}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}
