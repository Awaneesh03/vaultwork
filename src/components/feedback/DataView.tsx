import type { ReactNode } from 'react'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { SkeletonRows } from './Skeleton'

export interface DataViewProps<T> {
  /** `undefined` means still loading — that is `useLiveQuery`'s own signal. */
  data: T | undefined
  error?: Error | null
  isEmpty?: (data: T) => boolean
  loading?: ReactNode
  empty?: ReactNode
  onRetry?: () => void
  children: (data: T) => ReactNode
}

/**
 * Every list has four states: loading, empty, error, content.
 *
 * Written once, here, so it is not a decision repeated in eleven features — and
 * so no view can quietly forget the empty case and render a blank rectangle.
 */
export function DataView<T>({
  data,
  error,
  isEmpty,
  loading,
  empty,
  onRetry,
  children,
}: DataViewProps<T>) {
  if (error) {
    return <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />
  }
  if (data === undefined) {
    return <>{loading ?? <SkeletonRows />}</>
  }
  if (isEmpty?.(data)) {
    /*
     * The fallback exists so no view can render a blank rectangle, but a
     * caller reaching it has skipped the useful half of an empty state. It
     * says so plainly rather than pretending "Nothing here yet" is guidance.
     */
    return (
      <>
        {empty ?? (
          <EmptyState
            title="Nothing here yet"
            description="This list is empty. Once there is something to show, it will appear here."
          />
        )}
      </>
    )
  }
  return <>{children(data)}</>
}
