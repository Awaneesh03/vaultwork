import { describe, expect, it } from 'vitest'
import { addDays, toInstant } from '@/lib/date'
import type { DateStr, Habit, HabitEntry } from '@/types/entities'
import {
  WEEKDAYS,
  frequencyOf,
  isHabitActive,
  isHabitScheduledOn,
  scheduledDatesBetween,
  weeklyTarget,
} from './habitSchedule'
import {
  buildHistory,
  calculateCompletionRate,
  calculateCurrentStreak,
  calculateLongestStreak,
  isEntryComplete,
} from './habitStats'

/**
 * The habit rules, with no database, no clock and no DOM.
 *
 * The dates below are chosen so the weekday arithmetic is checkable by hand:
 * 2026-09-07 is a Monday, so 07–11 September is Mon–Fri and 12–13 is the
 * weekend. Every "does a weekend break the streak?" case is therefore a plain
 * assertion rather than something you have to reason about.
 */

const MON = '2026-09-07'
const TUE = '2026-09-08'
const WED = '2026-09-09'
const THU = '2026-09-10'
const FRI = '2026-09-11'
const SAT = '2026-09-12'
const SUN = '2026-09-13'
const NEXT_MON = '2026-09-14'

let seq = 0

function habit(overrides: Partial<Habit> = {}): Habit {
  seq += 1
  return {
    id: `habit-${seq}`,
    createdAt: toInstant('2026-01-01', '08:00'),
    updatedAt: 1,
    deletedAt: null,
    name: 'Read 20 pages',
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

/** Completed entries for the given dates. */
function done(habitId: string, dates: DateStr[], value = 1): HabitEntry[] {
  return dates.map((date, i) => ({
    id: `entry-${habitId}-${i}`,
    habitId,
    date,
    value,
    note: null,
    createdAt: i + 1,
    updatedAt: i + 1,
    deletedAt: null,
  }))
}

const SINCE = { since: '2026-01-01', weekStartsOn: 1 as const }

describe('the schedule', () => {
  it('makes a daily habit due every day', () => {
    const daily = habit()
    for (const date of [MON, SAT, SUN]) expect(isHabitScheduledOn(daily, date)).toBe(true)
  })

  it('makes a weekdays habit due Monday to Friday only', () => {
    const weekdays = habit({ daysOfWeek: WEEKDAYS })
    for (const date of [MON, TUE, WED, THU, FRI]) {
      expect(isHabitScheduledOn(weekdays, date)).toBe(true)
    }
    expect(isHabitScheduledOn(weekdays, SAT)).toBe(false)
    expect(isHabitScheduledOn(weekdays, SUN)).toBe(false)
  })

  it('honours a custom weekday set', () => {
    const mwf = habit({ daysOfWeek: [1, 3, 5] })
    expect(isHabitScheduledOn(mwf, MON)).toBe(true)
    expect(isHabitScheduledOn(mwf, TUE)).toBe(false)
    expect(isHabitScheduledOn(mwf, WED)).toBe(true)
    expect(isHabitScheduledOn(mwf, THU)).toBe(false)
    expect(isHabitScheduledOn(mwf, FRI)).toBe(true)
  })

  it('answers correctly for every single weekday', () => {
    // 2026-09-13 is a Sunday, so offsets 0..6 walk Sun, Mon, … Sat.
    for (let day = 0; day <= 6; day += 1) {
      const only = habit({ daysOfWeek: [day] })
      for (let offset = 0; offset <= 6; offset += 1) {
        const date = addDays(SUN, offset)
        expect(isHabitScheduledOn(only, date)).toBe(offset === day)
      }
    }
  })

  it('treats a weekly habit as available on any day', () => {
    const weekly = habit({ cadence: 'weekly', targetPerWeek: 3 })
    for (const date of [MON, SAT, SUN]) expect(isHabitScheduledOn(weekly, date)).toBe(true)
  })

  it('names the frequency each configuration represents', () => {
    expect(frequencyOf(habit())).toBe('daily')
    expect(frequencyOf(habit({ daysOfWeek: WEEKDAYS }))).toBe('weekdays')
    expect(frequencyOf(habit({ daysOfWeek: [5, 3, 1] }))).toBe('custom')
    expect(frequencyOf(habit({ cadence: 'weekly', targetPerWeek: 3 }))).toBe('weekly')
    // Order must not matter when recognising the weekdays preset.
    expect(frequencyOf(habit({ daysOfWeek: [5, 4, 3, 2, 1] }))).toBe('weekdays')
  })

  it('keeps lifecycle out of the schedule', () => {
    // An archived habit still *had* a Monday schedule — history depends on it.
    const archived = habit({ daysOfWeek: WEEKDAYS, archivedAt: 123 })
    expect(isHabitScheduledOn(archived, MON)).toBe(true)
    expect(isHabitActive(archived)).toBe(false)
    expect(isHabitActive(habit({ deletedAt: 123 }))).toBe(false)
    expect(isHabitActive(habit())).toBe(true)
  })

  it('lists only the scheduled dates in a range', () => {
    const weekdays = habit({ daysOfWeek: WEEKDAYS })
    expect(scheduledDatesBetween(weekdays, MON, SUN)).toEqual([MON, TUE, WED, THU, FRI])
  })

  it('floors a weekly target at one', () => {
    expect(weeklyTarget(habit({ cadence: 'weekly', targetPerWeek: null }))).toBe(1)
    expect(weeklyTarget(habit({ cadence: 'weekly', targetPerWeek: 0 }))).toBe(1)
    expect(weeklyTarget(habit({ cadence: 'weekly', targetPerWeek: 4 }))).toBe(4)
  })
})

describe('what counts as complete', () => {
  it('needs any positive value for a binary habit', () => {
    const binary = habit()
    expect(isEntryComplete(binary, done('h', [MON])[0])).toBe(true)
    expect(isEntryComplete(binary, done('h', [MON], 0)[0])).toBe(false)
    expect(isEntryComplete(binary, undefined)).toBe(false)
  })

  it('needs the target for a quantity habit', () => {
    // The seed already ships "Study, 90 minutes" — a 30-minute session is not
    // the same as a finished one, and the model carries the target to say so.
    const quantity = habit({ kind: 'quantity', unit: 'minutes', target: 90 })
    expect(isEntryComplete(quantity, done('h', [MON], 30)[0])).toBe(false)
    expect(isEntryComplete(quantity, done('h', [MON], 90)[0])).toBe(true)
    expect(isEntryComplete(quantity, done('h', [MON], 120)[0])).toBe(true)
  })

  it('ignores a deleted entry', () => {
    const entry = { ...done('h', [MON])[0]!, deletedAt: 5 }
    expect(isEntryComplete(habit(), entry)).toBe(false)
  })
})

describe('current streak', () => {
  const streak = (h: Habit, entries: HabitEntry[], today: DateStr) =>
    calculateCurrentStreak(h, entries, today, SINCE)

  it('is zero with no history', () => {
    expect(streak(habit(), [], FRI)).toBe(0)
  })

  it('counts a single completion today', () => {
    const h = habit()
    expect(streak(h, done(h.id, [FRI]), FRI)).toBe(1)
  })

  it('counts consecutive days for a daily habit', () => {
    const h = habit()
    expect(streak(h, done(h.id, [WED, THU, FRI]), FRI)).toBe(3)
  })

  it('breaks on a missed scheduled day', () => {
    const h = habit()
    // Wednesday missing: only Thursday and Friday count.
    expect(streak(h, done(h.id, [MON, TUE, THU, FRI]), FRI)).toBe(2)
  })

  it('does not break when today is merely not done yet', () => {
    const h = habit()
    // Friday still has hours left; the run to Thursday stands.
    expect(streak(h, done(h.id, [WED, THU]), FRI)).toBe(2)
  })

  it('survives a weekend for a weekdays habit', () => {
    const h = habit({ daysOfWeek: WEEKDAYS })
    // Mon–Fri done, then it is Monday again and nothing is logged yet.
    expect(streak(h, done(h.id, [MON, TUE, WED, THU, FRI]), SUN)).toBe(5)
    expect(streak(h, done(h.id, [MON, TUE, WED, THU, FRI]), NEXT_MON)).toBe(5)
  })

  it('breaks once a scheduled Monday is actually missed', () => {
    const h = habit({ daysOfWeek: WEEKDAYS })
    // The next Monday came and went unlogged, and now it is Tuesday.
    expect(streak(h, done(h.id, [MON, TUE, WED, THU, FRI]), addDays(NEXT_MON, 1))).toBe(0)
  })

  it('skips unscheduled days on a custom schedule', () => {
    const mwf = habit({ daysOfWeek: [1, 3, 5] })
    // Tuesday and Thursday were never owed.
    expect(streak(mwf, done(mwf.id, [MON, WED, FRI]), FRI)).toBe(3)
  })

  it('never counts days before the habit existed', () => {
    const h = habit()
    const since = { ...SINCE, since: THU }
    // Entries exist for Monday, but the habit was created on Thursday.
    expect(calculateCurrentStreak(h, done(h.id, [MON, TUE, WED, THU]), THU, since)).toBe(1)
  })

  it('is zero for a habit created today with nothing logged', () => {
    const h = habit()
    expect(calculateCurrentStreak(h, [], FRI, { ...SINCE, since: FRI })).toBe(0)
  })

  it('ignores entries dated in the future', () => {
    const h = habit()
    // A future row must not extend today's run.
    expect(streak(h, done(h.id, [THU, FRI, SAT, SUN]), FRI)).toBe(2)
  })

  describe('weekly cadence', () => {
    it('counts consecutive weeks that met the target', () => {
      const h = habit({ cadence: 'weekly', targetPerWeek: 2 })
      const entries = done(h.id, [
        // Week of 31 Aug: two done.
        '2026-09-01',
        '2026-09-03',
        // Week of 7 Sep: two done.
        MON,
        WED,
      ])
      expect(streak(h, entries, FRI)).toBe(2)
    })

    it('does not break while the current week is still running', () => {
      const h = habit({ cadence: 'weekly', targetPerWeek: 3 })
      const entries = done(h.id, ['2026-09-01', '2026-09-02', '2026-09-03', MON])
      // This week has one of three so far; last week's success still counts.
      expect(streak(h, entries, TUE)).toBe(1)
    })

    it('breaks on a completed week that fell short', () => {
      const h = habit({ cadence: 'weekly', targetPerWeek: 3 })
      // Last week managed only one; this week is fine.
      const entries = done(h.id, ['2026-09-01', MON, TUE, WED])
      expect(streak(h, entries, FRI)).toBe(1)
    })
  })
})

describe('longest streak', () => {
  it('is zero with no history', () => {
    expect(calculateLongestStreak(habit(), [], MON, SUN)).toBe(0)
  })

  it('finds the best run, not the most recent one', () => {
    const h = habit()
    // Mon–Wed is three; Fri alone is one. The answer is the earlier run.
    expect(calculateLongestStreak(h, done(h.id, [MON, TUE, WED, FRI]), MON, SUN)).toBe(3)
  })

  it('ignores unscheduled days between scheduled ones', () => {
    const h = habit({ daysOfWeek: WEEKDAYS })
    const entries = done(h.id, [MON, TUE, WED, THU, FRI, NEXT_MON])
    // The weekend does not interrupt the run: six scheduled days in a row.
    expect(calculateLongestStreak(h, entries, MON, NEXT_MON)).toBe(6)
  })

  it('counts weeks for a weekly habit', () => {
    const h = habit({ cadence: 'weekly', targetPerWeek: 1 })
    const entries = done(h.id, ['2026-09-01', MON, NEXT_MON])
    expect(calculateLongestStreak(h, entries, '2026-08-31', NEXT_MON)).toBe(3)
  })

  it('is bounded by the range it was given', () => {
    const h = habit()
    const entries = done(h.id, [MON, TUE, WED, THU, FRI])
    // Asked about Wed–Fri only, it reports three rather than five.
    expect(calculateLongestStreak(h, entries, WED, FRI)).toBe(3)
  })
})

describe('completion rate', () => {
  it('divides by scheduled occurrences, not by elapsed days', () => {
    const h = habit({ daysOfWeek: WEEKDAYS })
    const rate = calculateCompletionRate(h, done(h.id, [MON, TUE, WED, THU]), MON, SUN)
    // Four of five weekdays — the weekend is not in the denominator.
    expect(rate).toEqual({ scheduled: 5, completed: 4, percent: 80 })
  })

  it('counts every day for a daily habit', () => {
    const h = habit()
    const rate = calculateCompletionRate(h, done(h.id, [MON, TUE, WED, THU, FRI]), MON, SUN)
    expect(rate).toEqual({ scheduled: 7, completed: 5, percent: 71 })
  })

  it('reports a perfect week as 100 %', () => {
    const h = habit({ daysOfWeek: WEEKDAYS })
    const rate = calculateCompletionRate(h, done(h.id, [MON, TUE, WED, THU, FRI]), MON, SUN)
    expect(rate.percent).toBe(100)
  })

  it('reports nothing done as 0 %', () => {
    const h = habit()
    expect(calculateCompletionRate(h, [], MON, SUN)).toEqual({
      scheduled: 7,
      completed: 0,
      percent: 0,
    })
  })

  it('does not divide by zero when nothing was scheduled', () => {
    const sundayOnly = habit({ daysOfWeek: [0] })
    // Monday to Friday contains no Sunday at all.
    expect(calculateCompletionRate(sundayOnly, [], MON, FRI)).toEqual({
      scheduled: 0,
      completed: 0,
      percent: 0,
    })
  })

  it('judges a weekly habit against its weekly target', () => {
    const h = habit({ cadence: 'weekly', targetPerWeek: 3 })
    const rate = calculateCompletionRate(h, done(h.id, [MON, TUE]), MON, SUN)
    expect(rate).toEqual({ scheduled: 3, completed: 2, percent: 67 })
  })

  it('does not let an over-achieving week exceed its target', () => {
    const h = habit({ cadence: 'weekly', targetPerWeek: 2 })
    const rate = calculateCompletionRate(h, done(h.id, [MON, TUE, WED, THU]), MON, SUN)
    expect(rate).toEqual({ scheduled: 2, completed: 2, percent: 100 })
  })

  it('respects the target of a quantity habit', () => {
    const h = habit({ kind: 'quantity', unit: 'pages', target: 20 })
    const entries = [...done(h.id, [MON], 20), ...done(h.id, [TUE], 5)]
    const rate = calculateCompletionRate(h, entries, MON, TUE)
    expect(rate).toEqual({ scheduled: 2, completed: 1, percent: 50 })
  })
})

describe('history', () => {
  it('distinguishes done, missed and never-scheduled days', () => {
    const h = habit({ daysOfWeek: WEEKDAYS })
    const history = buildHistory(h, done(h.id, [MON, TUE, THU]), MON, SUN, SUN)

    expect(history.map((day) => day.state)).toEqual([
      'done', // Mon
      'done', // Tue
      'missed', // Wed — owed and not done
      'done', // Thu
      'missed', // Fri
      'off', // Sat — never owed
      'off', // Sun
    ])
  })

  it('marks a scheduled future day as future rather than missed', () => {
    const h = habit()
    const history = buildHistory(h, [], WED, FRI, WED)
    expect(history.map((day) => day.state)).toEqual(['missed', 'future', 'future'])
  })

  it('carries the logged value for a quantity habit', () => {
    const h = habit({ kind: 'quantity', unit: 'pages', target: 20 })
    const history = buildHistory(h, done(h.id, [MON], 12), MON, MON, MON)
    // Twelve of twenty pages: a real value, but not a completion.
    expect(history[0]).toEqual({ date: MON, state: 'missed', value: 12 })
  })

  it('creates no record for an unscheduled day', () => {
    const h = habit({ daysOfWeek: WEEKDAYS })
    const history = buildHistory(h, [], SAT, SUN, SUN)
    // `off` days have no entry and no value — nothing was ever written.
    expect(history.every((day) => day.value === null && day.state === 'off')).toBe(true)
  })
})
