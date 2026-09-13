import type { Goal, Milestone } from '@/types/entities'
import type { GoalHorizon } from '@/types/enums'

/**
 * The composer forms, as plain values.
 *
 * Separate from the components for the reason the habit form is: a form value
 * is testable on its own, and mixing constants and functions into a component
 * file breaks fast refresh. Both shapes are all-strings, because that is what
 * an `<input>` holds — the empty string is the form's way of saying "null", and
 * the translation happens once, at submit.
 */

export interface GoalFormValue {
  title: string
  why: string
  horizon: GoalHorizon
  targetDate: string
}

export const emptyGoalForm = (): GoalFormValue => ({
  title: '',
  why: '',
  horizon: 'long',
  targetDate: '',
})

export const goalForm = (goal: Goal): GoalFormValue => ({
  title: goal.title,
  why: goal.why ?? '',
  horizon: goal.horizon,
  targetDate: goal.targetDate ?? '',
})

export function goalFormError(value: GoalFormValue): string | null {
  return value.title.trim().length === 0 ? 'A goal needs a title.' : null
}

export interface MilestoneFormValue {
  title: string
  targetDate: string
}

export const emptyMilestoneForm = (): MilestoneFormValue => ({ title: '', targetDate: '' })

export const milestoneForm = (milestone: Milestone): MilestoneFormValue => ({
  title: milestone.title,
  targetDate: milestone.targetDate ?? '',
})

export function milestoneFormError(value: MilestoneFormValue): string | null {
  return value.title.trim().length === 0 ? 'A milestone needs a title.' : null
}

/** An empty date input means "no date", never the epoch. */
export const dateOrNull = (value: string): string | null => (value.length > 0 ? value : null)

/** An empty textarea means "nothing written", never an empty string on the row. */
export const textOrNull = (value: string): string | null =>
  value.trim().length > 0 ? value.trim() : null
