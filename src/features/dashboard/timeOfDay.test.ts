import { describe, expect, it } from 'vitest'
import {
  getNextBoundaryDate,
  getTimeOfDay,
  greetingForTimeOfDay,
  msUntilNextBoundary,
  resolveEffectiveTimeOfDay,
} from './timeOfDay'

describe('getTimeOfDay - exact local time ranges', () => {
  const at = (hours: number, minutes: number): Date => {
    const d = new Date(2026, 8, 3, hours, minutes, 0, 0)
    return d
  }

  it('1. 05:00 -> morning', () => {
    expect(getTimeOfDay(at(5, 0))).toBe('morning')
  })

  it('2. 11:59 -> morning', () => {
    expect(getTimeOfDay(at(11, 59))).toBe('morning')
  })

  it('3. 12:00 -> afternoon', () => {
    expect(getTimeOfDay(at(12, 0))).toBe('afternoon')
  })

  it('4. 16:59 -> afternoon', () => {
    expect(getTimeOfDay(at(16, 59))).toBe('afternoon')
  })

  it('5. 17:00 -> evening', () => {
    expect(getTimeOfDay(at(17, 0))).toBe('evening')
  })

  it('6. 20:59 -> evening', () => {
    expect(getTimeOfDay(at(20, 59))).toBe('evening')
  })

  it('7. 21:00 -> night', () => {
    expect(getTimeOfDay(at(21, 0))).toBe('night')
  })

  it('8. 04:59 -> night', () => {
    expect(getTimeOfDay(at(4, 59))).toBe('night')
  })

  it('9. 05:00 -> morning (next day transition)', () => {
    expect(getTimeOfDay(at(5, 0))).toBe('morning')
  })
})

describe('greetingForTimeOfDay', () => {
  it('maps time-of-day categories to the correct GreetingKey', () => {
    expect(greetingForTimeOfDay('morning')).toBe('morning')
    expect(greetingForTimeOfDay('afternoon')).toBe('afternoon')
    expect(greetingForTimeOfDay('evening')).toBe('evening')
    expect(greetingForTimeOfDay('night')).toBe('lateNight')
  })
})

describe('boundary detection and delay calculation', () => {
  it('calculates the next boundary date correctly during the day', () => {
    // At 10:30 AM -> Next boundary is 12:00 PM today
    const now = new Date(2026, 8, 3, 10, 30, 0, 0)
    const next = getNextBoundaryDate(now)
    expect(next.getHours()).toBe(12)
    expect(next.getMinutes()).toBe(0)
    expect(next.getDate()).toBe(3)
  })

  it('calculates the next boundary date across midnight', () => {
    // At 22:30 -> Next boundary is 05:00 tomorrow
    const now = new Date(2026, 8, 3, 22, 30, 0, 0)
    const next = getNextBoundaryDate(now)
    expect(next.getHours()).toBe(5)
    expect(next.getMinutes()).toBe(0)
    expect(next.getDate()).toBe(4)
  })

  it('calculates positive msUntilNextBoundary', () => {
    const now = new Date(2026, 8, 3, 16, 59, 0, 0)
    const ms = msUntilNextBoundary(now)
    // Approximately 1 minute remaining (plus 50ms buffer)
    expect(ms).toBeGreaterThan(50_000)
    expect(ms).toBeLessThan(70_000)
  })
})

describe('resolveEffectiveTimeOfDay', () => {
  it('resolves using clock date when no test override is given', () => {
    const morning = new Date(2026, 8, 3, 9, 0, 0, 0)
    const res = resolveEffectiveTimeOfDay(morning)
    expect(res.timeOfDay).toBe('morning')
    expect(res.greeting).toBe('morning')
  })

  it('honors internal test overrides in dev mode', () => {
    const morning = new Date(2026, 8, 3, 9, 0, 0, 0)
    const res = resolveEffectiveTimeOfDay(morning, 'evening', true)
    expect(res.timeOfDay).toBe('evening')
    expect(res.greeting).toBe('evening')
  })

  it('ignores test overrides in production builds', () => {
    const morning = new Date(2026, 8, 3, 9, 0, 0, 0)
    const res = resolveEffectiveTimeOfDay(morning, 'evening', false)
    expect(res.timeOfDay).toBe('morning')
    expect(res.greeting).toBe('morning')
  })
})
