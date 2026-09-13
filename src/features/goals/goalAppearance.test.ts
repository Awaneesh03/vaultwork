import { describe, expect, it } from 'vitest'
import {
  GOAL_HEALTH_LABELS,
  GOAL_STATUS_LABELS,
  describeBasis,
  formatGoalDate,
} from './goalAppearance'

/**
 * How goal state is put into words.
 *
 * The date formatter is the one with a real rule behind it: a goal deadline is
 * routinely a year out, where M3's task label would be ambiguous.
 */

const TODAY = '2026-09-03'

describe('formatGoalDate', () => {
  it('leaves dates in the current year exactly as tasks show them', () => {
    expect(formatGoalDate('2026-09-03', TODAY)).toBe('Today')
    expect(formatGoalDate('2026-09-04', TODAY)).toBe('Tomorrow')
    expect(formatGoalDate('2026-09-02', TODAY)).toBe('Yesterday')
    // Within the week, a bare weekday is unambiguous.
    expect(formatGoalDate('2026-09-06', TODAY)).toBe('Sunday')
    expect(formatGoalDate('2026-12-01', TODAY)).toBe('Tue 1 Dec')
  })

  it('adds the year once a date leaves the current one', () => {
    // Without this, a goal due in May 2027 and one due in May 2028 would read
    // identically — which is exactly the case goals hit and tasks do not.
    expect(formatGoalDate('2027-05-02', TODAY)).toBe('Sun 2 May 2027')
    expect(formatGoalDate('2028-05-02', TODAY)).toBe('Tue 2 May 2028')
    expect(formatGoalDate('2025-01-01', TODAY)).toBe('Wed 1 Jan 2025')
  })

  it('does not qualify a relative label that crosses a year boundary', () => {
    // "Tomorrow" is never ambiguous, even on 31 December.
    expect(formatGoalDate('2027-01-01', '2026-12-31')).toBe('Tomorrow')
  })
})

describe('labels', () => {
  it('gives every health state a word, so colour is never the only signal', () => {
    expect(Object.values(GOAL_HEALTH_LABELS).every((label) => label.length > 0)).toBe(true)
    expect(GOAL_HEALTH_LABELS.overdue).toBe('Overdue')
  })

  it('presents the model dropped status as Archived', () => {
    expect(GOAL_STATUS_LABELS.dropped).toBe('Archived')
    expect(GOAL_STATUS_LABELS.achieved).toBe('Complete')
  })

  it('says which figure a percentage came from, singular and plural', () => {
    expect(describeBasis(5, 12)).toBe('5 milestones')
    expect(describeBasis(1, 0)).toBe('1 milestone')
    expect(describeBasis(0, 4)).toBe('4 tasks')
    expect(describeBasis(0, 1)).toBe('1 task')
    expect(describeBasis(0, 0)).toBe('nothing tracked yet')
  })
})
