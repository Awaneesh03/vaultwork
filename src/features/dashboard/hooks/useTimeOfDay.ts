import { useCallback, useEffect, useState } from 'react'
import { platform } from '@/platform'
import { toDateStr } from '@/lib/date'
import type { GreetingKey } from '@/services'
import type { DateStr } from '@/types/entities'
import { isPreviewActive } from '../previewTime'
import { msUntilNextBoundary, resolveEffectiveTimeOfDay, type TimeOfDay } from '../timeOfDay'

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
  /**
   * The local calendar day, from the real clock (a preview never moves it).
   * Changes at midnight on the minute tick, or at once on focus/resume, so
   * anything keyed on it re-derives "today" without a database write.
   */
  date: DateStr
}

type TimeState = { timeOfDay: TimeOfDay; greeting: GreetingKey; date: DateStr }

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

  const [state, setState] = useState<TimeState>(() => {
    const now = getNow()
    return { ...resolveEffectiveTimeOfDay(now, testOverride), date: toDateStr(now) }
  })

  // Only a *valid development* preview pins the time. In production, or for
  // an unrecognised value, the parameter is ignored and the clock keeps
  // driving the greeting — the timers and resume listeners below must still
  // run, or a stray `?previewTime=` would freeze the greeting at load time.
  const previewActive = isPreviewActive(testOverride)

  useEffect(() => {
    if (previewActive) {
      const now = getNow()
      setState({ ...resolveEffectiveTimeOfDay(now, testOverride), date: toDateStr(now) })
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const checkAndUpdate = () => {
      const now = getNow()
      const current = { ...resolveEffectiveTimeOfDay(now, null), date: toDateStr(now) }
      // Same object back when nothing changed, so the minute tick re-renders
      // nothing on the 1,435 minutes a day that are not a boundary.
      setState((prev) =>
        prev.timeOfDay !== current.timeOfDay ||
        prev.greeting !== current.greeting ||
        prev.date !== current.date
          ? current
          : prev,
      )
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

    // Leaving a preview, or a new clock source, must show the real time now
    // rather than at the next boundary.
    checkAndUpdate()
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
  }, [previewActive, testOverride, getNow])

  const isEvening = state.timeOfDay === 'evening' || state.timeOfDay === 'night'

  return {
    timeOfDay: state.timeOfDay,
    greeting: state.greeting,
    isEvening,
    date: state.date,
  }
}
