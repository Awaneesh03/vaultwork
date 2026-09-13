import { describe, expect, it } from 'vitest'
import { DEFAULT_HABIT_COLOR as SERVICE_COLOR, WEEKDAYS as SERVICE_WEEKDAYS } from '@/services'
import type { Habit } from '@/types/entities'
import { DEFAULT_HABIT_COLOR, WEEKDAYS } from './habitDefaults'
import {
  emptyHabitForm,
  habitForm,
  habitFormError,
  toHabitInput,
  toHabitPatch,
} from './habitFormValue'

/**
 * The boundary between the composer's four frequencies and the model's two
 * schedule fields — and the assertion that keeps the UI's defaults in step with
 * the service's, since the UI layer may not import a service value.
 */

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    name: 'Read',
    color: 'teal',
    cadence: 'daily',
    daysOfWeek: [],
    targetPerWeek: null,
    kind: 'binary',
    unit: null,
    target: null,
    sortOrder: 1000,
    archivedAt: null,
    ...overrides,
  }
}

describe('duplicated defaults', () => {
  it('agrees with the service', () => {
    expect(DEFAULT_HABIT_COLOR).toBe(SERVICE_COLOR)
    expect(WEEKDAYS).toEqual(SERVICE_WEEKDAYS)
  })
})

describe('validation', () => {
  it('needs a name', () => {
    expect(habitFormError(emptyHabitForm())).toBe('A habit needs a name')
    expect(habitFormError({ ...emptyHabitForm(), name: '  ' })).toBe('A habit needs a name')
  })

  it('needs at least one day for a custom schedule', () => {
    const value = { ...emptyHabitForm(), name: 'Gym', frequency: 'custom' as const, daysOfWeek: [] }
    expect(habitFormError(value)).toBe('Pick at least one day')
  })

  it('accepts a named daily habit', () => {
    expect(habitFormError({ ...emptyHabitForm(), name: 'Read' })).toBeNull()
  })
})

describe('loading a habit into the form', () => {
  it('recognises each frequency the model can express', () => {
    expect(habitForm(habit()).frequency).toBe('daily')
    expect(habitForm(habit({ daysOfWeek: [1, 2, 3, 4, 5] })).frequency).toBe('weekdays')
    expect(habitForm(habit({ daysOfWeek: [1, 3] })).frequency).toBe('custom')
    expect(
      habitForm(habit({ cadence: 'weekly', targetPerWeek: 2 })).frequency,
    ).toBe('weekly')
  })

  it('keeps the days a custom habit actually has', () => {
    expect(habitForm(habit({ daysOfWeek: [2, 4] })).daysOfWeek).toEqual([2, 4])
  })
})

describe('turning a frequency into schedule fields', () => {
  it('maps every frequency onto cadence, days and target', () => {
    const base = { ...emptyHabitForm(), name: 'X' }

    expect(toHabitInput({ ...base, frequency: 'daily' })).toMatchObject({
      cadence: 'daily',
      daysOfWeek: [],
      targetPerWeek: null,
    })
    expect(toHabitInput({ ...base, frequency: 'weekdays' })).toMatchObject({
      cadence: 'daily',
      daysOfWeek: [1, 2, 3, 4, 5],
    })
    expect(toHabitInput({ ...base, frequency: 'custom', daysOfWeek: [5, 1] })).toMatchObject({
      cadence: 'daily',
      daysOfWeek: [1, 5],
    })
    expect(
      toHabitInput({ ...base, frequency: 'weekly', targetPerWeek: '3' }),
    ).toMatchObject({ cadence: 'weekly', daysOfWeek: [], targetPerWeek: 3 })
  })

  it('clamps a nonsense weekly target into range', () => {
    const base = { ...emptyHabitForm(), name: 'X', frequency: 'weekly' as const }
    expect(toHabitInput({ ...base, targetPerWeek: '0' }).targetPerWeek).toBe(1)
    expect(toHabitInput({ ...base, targetPerWeek: '99' }).targetPerWeek).toBe(7)
    expect(toHabitInput({ ...base, targetPerWeek: '' }).targetPerWeek).toBe(1)
  })
})

describe('toHabitPatch', () => {
  it('sends only what changed', () => {
    const current = habit({ name: 'Read', color: 'teal' })
    const value = { ...habitForm(current), color: 'violet' }
    expect(toHabitPatch(value, current)).toEqual({ color: 'violet' })
  })

  it('sends nothing when nothing changed', () => {
    const current = habit({ daysOfWeek: [1, 3] })
    expect(toHabitPatch(habitForm(current), current)).toEqual({})
  })

  it('carries a whole schedule change together', () => {
    const current = habit()
    const value = { ...habitForm(current), frequency: 'weekdays' as const }
    expect(toHabitPatch(value, current)).toEqual({ daysOfWeek: [1, 2, 3, 4, 5] })
  })

  it('swaps a daily habit to weekly cleanly', () => {
    const current = habit({ daysOfWeek: [1, 3] })
    const value = { ...habitForm(current), frequency: 'weekly' as const, targetPerWeek: '2' }
    expect(toHabitPatch(value, current)).toEqual({
      cadence: 'weekly',
      targetPerWeek: 2,
      daysOfWeek: [],
    })
  })

  it('never includes the id, so a save cannot fork the habit', () => {
    const current = habit()
    const patch = toHabitPatch({ ...habitForm(current), name: 'Renamed' }, current)
    expect(Object.keys(patch)).toEqual(['name'])
  })
})
