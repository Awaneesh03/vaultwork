import type { HabitFrequency, HabitInput, HabitPatch } from '@/services'
import type { Habit } from '@/types/entities'
import { DEFAULT_HABIT_COLOR, WEEKDAYS } from './habitDefaults'

/**
 * The habit composer's own shape.
 *
 * Every field is a string or a plain array, because that is what form controls
 * hold: a half-typed target is `"2"`, not `NaN`. `toHabitInput` and
 * `toHabitPatch` are the single place those become the model's fields — the
 * same split `composerValue.ts` and `projectFormValue.ts` make.
 *
 * The four frequencies collapse into the model's two schedule fields here, so
 * the rest of the application never sees a "frequency" that does not exist in
 * the database.
 */
export interface HabitFormValue {
  name: string
  frequency: HabitFrequency
  /** Only meaningful when the frequency is `custom`. 0 = Sunday. */
  daysOfWeek: number[]
  /** Only meaningful when the frequency is `weekly`. */
  targetPerWeek: string
  color: string
}

export function emptyHabitForm(): HabitFormValue {
  return {
    name: '',
    frequency: 'daily',
    daysOfWeek: [1, 3, 5],
    targetPerWeek: '3',
    color: DEFAULT_HABIT_COLOR,
  }
}

/** Loads an existing habit into the form. Editing starts from the truth. */
export function habitForm(habit: Habit): HabitFormValue {
  const frequency: HabitFrequency =
    habit.cadence === 'weekly'
      ? 'weekly'
      : habit.daysOfWeek.length === 0
        ? 'daily'
        : sameDays(habit.daysOfWeek, WEEKDAYS)
          ? 'weekdays'
          : 'custom'

  return {
    name: habit.name,
    frequency,
    daysOfWeek: habit.daysOfWeek.length > 0 ? [...habit.daysOfWeek] : [1, 3, 5],
    targetPerWeek: String(habit.targetPerWeek ?? 3),
    color: habit.color,
  }
}

function sameDays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}

export function habitFormError(value: HabitFormValue): string | null {
  if (value.name.trim().length === 0) return 'A habit needs a name'
  if (value.frequency === 'custom' && value.daysOfWeek.length === 0) {
    return 'Pick at least one day'
  }
  return null
}

interface ScheduleFields {
  cadence: Habit['cadence']
  daysOfWeek: number[]
  targetPerWeek: number | null
}

/** The schedule half, shared by create and edit. Always fully specified. */
function schedule(value: HabitFormValue): ScheduleFields {
  switch (value.frequency) {
    case 'daily':
      return { cadence: 'daily', daysOfWeek: [], targetPerWeek: null }
    case 'weekdays':
      return { cadence: 'daily', daysOfWeek: [...WEEKDAYS], targetPerWeek: null }
    case 'custom':
      return { cadence: 'daily', daysOfWeek: [...value.daysOfWeek].sort(), targetPerWeek: null }
    case 'weekly': {
      const target = Number.parseInt(value.targetPerWeek, 10)
      return {
        cadence: 'weekly',
        daysOfWeek: [],
        targetPerWeek: Number.isFinite(target) ? Math.min(7, Math.max(1, target)) : 1,
      }
    }
  }
}

export function toHabitInput(value: HabitFormValue): Omit<HabitInput, 'name'> {
  return { ...schedule(value), color: value.color }
}

/**
 * Only the fields that actually differ.
 *
 * The service ignores a no-op patch anyway, but sending one field instead of
 * five also keeps the `habit.updated` event's `fields` payload truthful.
 */
export function toHabitPatch(value: HabitFormValue, current: Habit): HabitPatch {
  const next = schedule(value)
  const patch: HabitPatch = {}

  const name = value.name.trim().replace(/\s+/g, ' ')
  if (name !== current.name) patch.name = name
  if (value.color !== current.color) patch.color = value.color
  if (next.cadence !== current.cadence) patch.cadence = next.cadence
  if (next.targetPerWeek !== current.targetPerWeek) patch.targetPerWeek = next.targetPerWeek
  if (!sameDays(next.daysOfWeek, current.daysOfWeek)) patch.daysOfWeek = next.daysOfWeek

  return patch
}
