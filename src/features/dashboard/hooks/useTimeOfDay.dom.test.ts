import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimeOfDay } from './useTimeOfDay'

/**
 * The live greeting: it must follow the local clock across every boundary,
 * catch up after the machine sleeps, and ignore `?previewTime=` wherever the
 * preview is not a valid development override.
 *
 * The clock is a controllable function rather than the real one, and timers
 * are fake, so nothing here depends on when the suite happens to run.
 */

let current = new Date(2026, 8, 3, 9, 0, 0, 0)
const clock = () => new Date(current)
const setClock = (hours: number, minutes: number, seconds = 0) => {
  current = new Date(2026, 8, 3, hours, minutes, seconds, 0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 3, 9, 0, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** Moves the fake clock and the timers forward together. */
function advance(ms: number) {
  current = new Date(current.getTime() + ms)
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('live transitions', () => {
  it.each([
    { from: [4, 59, 30], before: 'lateNight', after: 'morning' },
    { from: [11, 59, 30], before: 'morning', after: 'afternoon' },
    { from: [16, 59, 30], before: 'afternoon', after: 'evening' },
    { from: [20, 59, 30], before: 'evening', after: 'lateNight' },
  ] as const)('changes from $before to $after on the boundary', ({ from, before, after }) => {
    setClock(from[0], from[1], from[2])
    const { result } = renderHook(() => useTimeOfDay({ now: clock }))
    expect(result.current.greeting).toBe(before)

    advance(29_000)
    expect(result.current.greeting).toBe(before)

    advance(2_000)
    expect(result.current.greeting).toBe(after)
  })

  it('marks evening and night as the evening dashboard, and only those', () => {
    setClock(16, 59)
    const { result } = renderHook(() => useTimeOfDay({ now: clock }))
    expect(result.current.isEvening).toBe(false)

    advance(61_000)
    expect(result.current.timeOfDay).toBe('evening')
    expect(result.current.isEvening).toBe(true)
  })
})

describe('resume after sleep', () => {
  it('recalculates when the window regains focus', () => {
    setClock(10, 0)
    const { result } = renderHook(() => useTimeOfDay({ now: clock }))
    expect(result.current.greeting).toBe('morning')

    // The machine slept through the afternoon; no timer fired.
    setClock(18, 30)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current.greeting).toBe('evening')
  })

  it('recalculates when the page becomes visible again', () => {
    setClock(10, 0)
    const { result } = renderHook(() => useTimeOfDay({ now: clock }))

    setClock(22, 15)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.greeting).toBe('lateNight')
  })
})

describe('the preview parameter', () => {
  it('pins a valid preview in development', () => {
    setClock(9, 0)
    const { result } = renderHook(() => useTimeOfDay({ now: clock, testOverride: 'night' }))
    expect(result.current.greeting).toBe('lateNight')

    advance(4 * 60 * 60_000)
    expect(result.current.greeting).toBe('lateNight')
  })

  it.each(['noon', 'constructor', '__proto__', 'toString', ''])(
    'ignores the invalid preview %j and keeps following the clock',
    (value) => {
      setClock(16, 59, 30)
      const { result } = renderHook(() => useTimeOfDay({ now: clock, testOverride: value }))
      expect(result.current.greeting).toBe('afternoon')

      advance(31_000)
      expect(result.current.greeting).toBe('evening')
    },
  )

  it('is ignored in a production build, and the greeting still moves on its own', () => {
    vi.stubEnv('DEV', false)
    setClock(16, 59, 30)
    const { result } = renderHook(() => useTimeOfDay({ now: clock, testOverride: 'morning' }))
    expect(result.current.greeting).toBe('afternoon')

    advance(31_000)
    expect(result.current.greeting).toBe('evening')
  })
})

describe('the initial render at each boundary', () => {
  it.each([
    [20, 59, 'evening', 'evening'],
    [21, 0, 'night', 'lateNight'],
    [0, 0, 'night', 'lateNight'],
    [4, 59, 'night', 'lateNight'],
    [5, 0, 'morning', 'morning'],
  ] as const)('%i:%i is %s', (hours, minutes, timeOfDay, greeting) => {
    setClock(hours, minutes)
    const { result } = renderHook(() => useTimeOfDay({ now: clock }))
    expect(result.current.timeOfDay).toBe(timeOfDay)
    expect(result.current.greeting).toBe(greeting)
  })
})

describe('the local date', () => {
  it('rolls over at midnight on the minute tick', () => {
    setClock(23, 59, 30)
    const { result } = renderHook(() => useTimeOfDay({ now: clock }))
    expect(result.current.date).toBe('2026-09-03')

    advance(60_000)
    expect(result.current.date).toBe('2026-09-04')
    expect(result.current.greeting).toBe('lateNight')
  })

  it('does not re-render on minutes where nothing changes', () => {
    setClock(13, 0)
    let renders = 0
    renderHook(() => {
      renders += 1
      return useTimeOfDay({ now: clock })
    })
    const settled = renders

    advance(10 * 60_000)
    expect(renders).toBe(settled)
  })

  it('stops every timer and listener on unmount', () => {
    setClock(13, 0)
    const { unmount } = renderHook(() => useTimeOfDay({ now: clock }))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
