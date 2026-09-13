import { useCallback } from 'react'
import { updateSettings } from '@/services'
import { useSettings } from '@/hooks/useSettings'
import type { PomodoroSettings, Settings } from '@/types/entities'

/**
 * The preferences that change how the rest of Vaultwork counts.
 *
 * Week start, the daily target, and the pomodoro lengths have been in the
 * settings record — and read by Habits, the Dashboard and Focus — since those
 * screens were built, with no way to change any of them. A streak that resets
 * on the wrong day, or a Focus session locked to twenty-five minutes, was a
 * preference the user was simply not allowed to have.
 *
 * Writes go through `updateSettings`, the same service every other settings
 * write uses, so the live query refreshes every consumer with nothing to
 * invalidate.
 */
export interface WorkPreferences {
  /** `undefined` while the first read is in flight. */
  settings: Settings | undefined
  setWeekStart: (day: 0 | 1) => void
  setDailyTaskGoal: (goal: number) => void
  setPomodoro: (patch: Partial<PomodoroSettings>) => void
}

/** Guards against a spinner typed to nothing, or to nonsense. */
const clamp = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : low

export function useWorkPreferences(): WorkPreferences {
  const settings = useSettings()
  const pomodoro = settings?.pomodoro

  const setWeekStart = useCallback((day: 0 | 1) => {
    void updateSettings({ weekStartsOn: day })
  }, [])

  const setDailyTaskGoal = useCallback((goal: number) => {
    void updateSettings({ dailyTaskGoal: clamp(goal, 1, 50) })
  }, [])

  const setPomodoro = useCallback(
    (patch: Partial<PomodoroSettings>) => {
      if (pomodoro === undefined) return
      const next: PomodoroSettings = {
        ...pomodoro,
        ...patch,
      }
      void updateSettings({
        pomodoro: {
          // An hour is already a long focus block and a minute is not one at
          // all; the bounds exist so a typo cannot make the timer meaningless.
          workMin: clamp(next.workMin, 1, 180),
          shortBreakMin: clamp(next.shortBreakMin, 1, 60),
          longBreakMin: clamp(next.longBreakMin, 1, 120),
          cyclesBeforeLongBreak: clamp(next.cyclesBeforeLongBreak, 1, 12),
        },
      })
    },
    [pomodoro],
  )

  return { settings, setWeekStart, setDailyTaskGoal, setPomodoro }
}
