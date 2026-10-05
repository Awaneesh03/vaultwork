import { useCallback, useEffect, useState } from 'react'
import { platform } from '@/platform'
import type { GreetingKey } from '@/services'
import {
  msUntilNextBoundary,
  resolveEffectiveTimeOfDay,
  type TimeOfDay,
} from '../timeOfDay'

export interface UseTimeOfDayOptions {
  /**
   * Internal test/dev parameter override without exposing any UI controls.
   */
  testOverride?: string | null | undefined
  /**
   * Optional custom clock source for testing. Defaults to () => new Date().
   */
  now?: (() => Date) | undefined
}

export interface UseTimeOfDayResult {
  timeOfDay: TimeOfDay
  greeting: GreetingKey
  isEvening: boolean
}

/**
 * Hook that automatically tracks the user's local time-of-day.
 *
 * Requirements:
 * 1. Automatically recalculates across live time boundaries (05:00, 12:00, 17:00, 21:00).
 * 2. Recalculates immediately upon application resume / visibility / window focus (e.g. after sleep).
 * 3. Fallback minute-interval check ensures synchronization even if sleep suspended timers.
 * 4. Zero visible UI controls; deterministic and pure local time.
 */
export function useTimeOfDay(options?: UseTimeOfDayOptions): UseTimeOfDayResult {
  const customNow = options?.now
  const getNow = useCallback(
    () => (customNow ? customNow() : new Date(platform.clock.now())),
    [customNow],
  )
  const testOverride = options?.testOverride

  const [state, setState] = useState<{ timeOfDay: TimeOfDay; greeting: GreetingKey }>(() =>
    resolveEffectiveTimeOfDay(getNow(), testOverride),
  )

  useEffect(() => {
    // If a test override is active, keep it synchronized
    if (testOverride && testOverride !== 'system') {
      setState(resolveEffectiveTimeOfDay(getNow(), testOverride))
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const checkAndUpdate = () => {
      const current = resolveEffectiveTimeOfDay(getNow(), null)
      setState((prev) => {
        if (prev.timeOfDay !== current.timeOfDay || prev.greeting !== current.greeting) {
          return current
        }
        return prev
      })
    }

    // Schedule the next boundary crossing exactly
    const scheduleBoundary = () => {
      const delay = msUntilNextBoundary(getNow())
      timeoutId = setTimeout(() => {
        checkAndUpdate()
        scheduleBoundary()
      }, delay)
    }

    // Handle application wake / resume / focus
    const handleResume = () => {
      checkAndUpdate()
      if (timeoutId) clearTimeout(timeoutId)
      scheduleBoundary()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleResume()
      }
    }

    scheduleBoundary()

    // Minute-level interval safety net
    const intervalId = setInterval(checkAndUpdate, 60_000)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', handleResume)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', handleResume)
    }
  }, [testOverride, getNow])

  const isEvening = state.timeOfDay === 'evening' || state.timeOfDay === 'night'

  return {
    timeOfDay: state.timeOfDay,
    greeting: state.greeting,
    isEvening,
  }
}
