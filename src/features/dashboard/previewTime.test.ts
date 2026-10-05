import { describe, expect, it } from 'vitest'
import { isPreviewActive, resolveDashboardGreeting } from './previewTime'

describe('resolveDashboardGreeting', () => {
  it('1. normal Dashboard uses the real time-of-day when previewTime is absent or system', () => {
    expect(resolveDashboardGreeting(null, 'morning', true)).toBe('morning')
    expect(resolveDashboardGreeting(undefined, 'afternoon', true)).toBe('afternoon')
    expect(resolveDashboardGreeting('', 'evening', true)).toBe('evening')
    expect(resolveDashboardGreeting('system', 'afternoon', true)).toBe('afternoon')
    expect(resolveDashboardGreeting('   ', 'lateNight', true)).toBe('lateNight')
  })

  it('2. previewTime=morning works in development', () => {
    expect(resolveDashboardGreeting('morning', 'evening', true)).toBe('morning')
    expect(resolveDashboardGreeting('MORNING', 'evening', true)).toBe('morning')
    expect(resolveDashboardGreeting('  morning  ', 'lateNight', true)).toBe('morning')
  })

  it('3. previewTime=afternoon works in development', () => {
    expect(resolveDashboardGreeting('afternoon', 'morning', true)).toBe('afternoon')
    expect(resolveDashboardGreeting('Afternoon', 'morning', true)).toBe('afternoon')
  })

  it('4. previewTime=evening works in development', () => {
    expect(resolveDashboardGreeting('evening', 'morning', true)).toBe('evening')
    expect(resolveDashboardGreeting('EVENING', 'morning', true)).toBe('evening')
  })

  it('5. previewTime=night works in development (mapping to lateNight)', () => {
    expect(resolveDashboardGreeting('night', 'morning', true)).toBe('lateNight')
    expect(resolveDashboardGreeting('NIGHT', 'morning', true)).toBe('lateNight')
    expect(resolveDashboardGreeting('lateNight', 'morning', true)).toBe('lateNight')
  })

  it('6. invalid previewTime falls back safely to real clock greeting', () => {
    expect(resolveDashboardGreeting('invalid', 'morning', true)).toBe('morning')
    expect(resolveDashboardGreeting('midnight', 'afternoon', true)).toBe('afternoon')
    expect(resolveDashboardGreeting('noon', 'evening', true)).toBe('evening')
    expect(resolveDashboardGreeting('123', 'lateNight', true)).toBe('lateNight')
  })

  it('7. production builds ignore the preview parameter and always use the real clock', () => {
    // In production, isDev is false
    expect(resolveDashboardGreeting('morning', 'evening', false)).toBe('evening')
    expect(resolveDashboardGreeting('afternoon', 'morning', false)).toBe('morning')
    expect(resolveDashboardGreeting('evening', 'morning', false)).toBe('morning')
    expect(resolveDashboardGreeting('night', 'afternoon', false)).toBe('afternoon')
    expect(resolveDashboardGreeting('lateNight', 'morning', false)).toBe('morning')
  })
})

describe('isPreviewActive', () => {
  it('returns false in production regardless of parameter', () => {
    expect(isPreviewActive('evening', false)).toBe(false)
  })

  it('returns false in development when parameter is absent, invalid, or system', () => {
    expect(isPreviewActive(null, true)).toBe(false)
    expect(isPreviewActive('', true)).toBe(false)
    expect(isPreviewActive('system', true)).toBe(false)
    expect(isPreviewActive('foo', true)).toBe(false)
  })

  it('returns true in development for valid previewTime values', () => {
    expect(isPreviewActive('morning', true)).toBe(true)
    expect(isPreviewActive('afternoon', true)).toBe(true)
    expect(isPreviewActive('evening', true)).toBe(true)
    expect(isPreviewActive('night', true)).toBe(true)
    expect(isPreviewActive('lateNight', true)).toBe(true)
  })
})
