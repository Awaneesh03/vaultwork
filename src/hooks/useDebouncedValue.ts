import { useEffect, useState } from 'react'

/**
 * Trails a value by `delay` milliseconds.
 *
 * Used by search: the input stays perfectly responsive because it owns its own
 * state, while the query that actually reads Dexie only re-runs once you stop
 * typing. Debouncing the input itself instead would make the field feel laggy,
 * which is the usual mistake.
 */
export function useDebouncedValue<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value)
      return
    }
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
