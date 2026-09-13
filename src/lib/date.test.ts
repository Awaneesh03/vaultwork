import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  addWeeks,
  assertDateStr,
  datesBetween,
  daysBetween,
  daysInMonth,
  endOfMonth,
  endOfWeek,
  formatDayLabel,
  formatEventTime,
  formatFullDate,
  formatMonthLabel,
  fromDateStr,
  isDateStr,
  isSameMonth,
  isTimeStr,
  isWeekend,
  minutesToTime,
  snapMinutes,
  snapTime,
  startOfMonth,
  startOfWeek,
  timeToMinutes,
  toDateStr,
  toInstant,
  toTimeStr,
  weekdayHeadings,
  weekdayOf,
} from './date'

/**
 * These tests run under TZ=Asia/Kolkata (UTC+05:30). That matters: an
 * implementation built on toISOString() passes every one of them under UTC and
 * fails several here, which is exactly the bug the convention exists to stop.
 */
describe('calendar dates', () => {
  it('uses the local calendar day, not the UTC one', () => {
    expect(toDateStr(new Date(2026, 8, 3, 0, 30))).toBe('2026-09-03')
    expect(toDateStr(new Date(2026, 8, 3, 23, 30))).toBe('2026-09-03')
  })

  it('disagrees with a naive UTC conversion where the offset demands it', () => {
    const earlyMorning = new Date(2026, 8, 3, 2, 0)
    const naive = earlyMorning.toISOString().slice(0, 10)
    expect(toDateStr(earlyMorning)).toBe('2026-09-03')
    expect(naive).toBe('2026-09-02')
  })

  it('round-trips through a Date at local midnight', () => {
    const date = fromDateStr('2026-02-28')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(1)
    expect(date.getDate()).toBe(28)
    expect(date.getHours()).toBe(0)
    expect(toDateStr(date)).toBe('2026-02-28')
  })

  it('validates shape and real-world existence', () => {
    expect(isDateStr('2026-09-03')).toBe(true)
    expect(isDateStr('2026-2-3')).toBe(false)
    expect(isDateStr('2026-02-30')).toBe(false)
    expect(isDateStr('2025-02-29')).toBe(false)
    expect(isDateStr('2024-02-29')).toBe(true)
    expect(isDateStr(20260903)).toBe(false)
    expect(() => assertDateStr('nope')).toThrow(TypeError)
  })

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-09-03', 0)).toBe('2026-09-03')
  })

  it('counts whole calendar days between dates', () => {
    expect(daysBetween('2026-09-03', '2026-09-10')).toBe(7)
    expect(daysBetween('2026-09-10', '2026-09-03')).toBe(-7)
    expect(daysBetween('2026-09-03', '2026-09-03')).toBe(0)
  })

  it('sorts lexically, which is why the format was chosen', () => {
    const dates = ['2026-10-01', '2026-09-03', '2025-12-31']
    expect([...dates].sort()).toEqual(['2025-12-31', '2026-09-03', '2026-10-01'])
  })
})

describe('times and instants', () => {
  it('validates HH:mm', () => {
    expect(isTimeStr('19:00')).toBe(true)
    expect(isTimeStr('07:05')).toBe(true)
    expect(isTimeStr('24:00')).toBe(false)
    expect(isTimeStr('7:00')).toBe(false)
    expect(isTimeStr('19:60')).toBe(false)
  })

  it('formats a Date as local wall-clock time', () => {
    expect(toTimeStr(new Date(2026, 8, 3, 7, 5))).toBe('07:05')
    expect(toTimeStr(new Date(2026, 8, 3, 19, 0))).toBe('19:00')
  })

  it('combines a date and a time into a local instant', () => {
    const instant = toInstant('2026-09-03', '19:00')
    const asDate = new Date(instant)
    expect(asDate.getHours()).toBe(19)
    expect(asDate.getMinutes()).toBe(0)
    expect(toDateStr(asDate)).toBe('2026-09-03')
  })

  it('treats a missing time as local midnight', () => {
    expect(new Date(toInstant('2026-09-03')).getHours()).toBe(0)
  })
})

describe('formatEventTime', () => {
  const TODAY = '2026-09-03'
  const now = toInstant(TODAY, '14:00')

  it('says "just now" for the last minute', () => {
    expect(formatEventTime(now, now, TODAY)).toBe('just now')
    expect(formatEventTime(now - 59_000, now, TODAY)).toBe('just now')
  })

  it('counts minutes, then hours, within the same local day', () => {
    expect(formatEventTime(now - 60_000, now, TODAY)).toBe('1m ago')
    expect(formatEventTime(now - 45 * 60_000, now, TODAY)).toBe('45m ago')
    expect(formatEventTime(now - 3 * 3_600_000, now, TODAY)).toBe('3h ago')
  })

  it('switches to a day name once it is no longer today', () => {
    // 20h ago but yesterday evening: the day is the more useful answer.
    expect(formatEventTime(toInstant('2026-09-02', '18:00'), now, TODAY)).toBe('Yesterday')
    expect(formatEventTime(toInstant('2026-08-30', '10:00'), now, TODAY)).toBe(
      formatDayLabel('2026-08-30', TODAY),
    )
  })

  it('never renders a negative age for a clock that has drifted', () => {
    expect(formatEventTime(now + 5_000, now, TODAY)).toBe('just now')
  })
})

/**
 * The calendar primitives added in M6.
 *
 * Still under TZ=Asia/Kolkata: every one of these goes through `fromDateStr` /
 * `toDateStr`, so a UTC-based implementation drifts by a day here and passes
 * under TZ=UTC. That is the whole point of running the suite off-UTC.
 */
describe('month arithmetic', () => {
  it('finds the first and last day of a month', () => {
    expect(startOfMonth('2026-09-17')).toBe('2026-09-01')
    expect(endOfMonth('2026-09-17')).toBe('2026-09-30')
    expect(endOfMonth('2026-01-01')).toBe('2026-01-31')
  })

  it('knows February in an ordinary year and in a leap year', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(daysInMonth('2026-02-10')).toBe(28)
    // 2028 is a leap year; 2100 is not, despite being divisible by four.
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
    expect(daysInMonth('2028-02-10')).toBe(29)
    expect(daysInMonth('2100-02-10')).toBe(28)
  })

  it('clamps the day when a month is too short, rather than overflowing', () => {
    // The bug this exists to prevent: 31 Jan + 1 month landing in March and
    // making a "next month" button skip February entirely.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-05-31', 1)).toBe('2026-06-30')
  })

  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonths('2026-06-15', 12)).toBe('2027-06-15')
  })

  it('compares months without comparing days', () => {
    expect(isSameMonth('2026-09-01', '2026-09-30')).toBe(true)
    expect(isSameMonth('2026-09-30', '2026-10-01')).toBe(false)
    expect(isSameMonth('2026-09-15', '2027-09-15')).toBe(false)
  })
})

describe('week arithmetic', () => {
  // 3 September 2026 is a Thursday.
  it('finds the start of the week for both conventions', () => {
    expect(weekdayOf('2026-09-03')).toBe(4)
    expect(startOfWeek('2026-09-03', 1)).toBe('2026-08-31')
    expect(startOfWeek('2026-09-03', 0)).toBe('2026-08-30')
  })

  it('leaves a date that is already the week start alone', () => {
    expect(startOfWeek('2026-08-31', 1)).toBe('2026-08-31')
    expect(startOfWeek('2026-08-30', 0)).toBe('2026-08-30')
  })

  it('ends the week six days after it starts', () => {
    expect(endOfWeek('2026-09-03', 1)).toBe('2026-09-06')
    expect(endOfWeek('2026-09-03', 0)).toBe('2026-09-05')
  })

  it('moves whole weeks, across a year boundary', () => {
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04')
    expect(addWeeks('2027-01-04', -1)).toBe('2026-12-28')
  })

  it('orders the weekday headings from the chosen start', () => {
    expect(weekdayHeadings(1)[0]).toBe('Monday')
    expect(weekdayHeadings(1)[6]).toBe('Sunday')
    expect(weekdayHeadings(0)[0]).toBe('Sunday')
    expect(weekdayHeadings(0)[6]).toBe('Saturday')
  })

  it('calls Saturday and Sunday the weekend, whatever the week start', () => {
    expect(isWeekend('2026-09-05')).toBe(true)
    expect(isWeekend('2026-09-06')).toBe(true)
    expect(isWeekend('2026-09-04')).toBe(false)
  })
})

describe('datesBetween', () => {
  it('is inclusive at both ends', () => {
    expect(datesBetween('2026-09-01', '2026-09-03')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ])
    expect(datesBetween('2026-09-01', '2026-09-01')).toEqual(['2026-09-01'])
  })

  it('crosses a month and a year boundary without gaps', () => {
    expect(datesBetween('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ])
    expect(datesBetween('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01'])
  })

  it('returns nothing for a reversed range rather than looping forever', () => {
    expect(datesBetween('2026-09-03', '2026-09-01')).toEqual([])
  })
})

describe('time of day', () => {
  it('converts between "HH:mm" and minutes since local midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('19:30')).toBe(1170)
    expect(timeToMinutes('23:59')).toBe(1439)
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(1170)).toBe('19:30')
    expect(minutesToTime(1439)).toBe('23:59')
  })

  it('clamps into the day, so nothing lands at "24:15"', () => {
    expect(minutesToTime(-30)).toBe('00:00')
    expect(minutesToTime(24 * 60)).toBe('23:59')
    expect(minutesToTime(99_999)).toBe('23:59')
  })

  it('snaps to the documented 15-minute boundaries', () => {
    // The exact examples the milestone specifies.
    expect(snapTime('18:07', 15)).toBe('18:00')
    expect(snapTime('18:08', 15)).toBe('18:15')
    expect(snapTime('18:22', 15)).toBe('18:15')
    expect(snapTime('18:23', 15)).toBe('18:30')
  })

  it('snaps exactly on a boundary to itself', () => {
    for (const time of ['18:00', '18:15', '18:30', '18:45']) {
      expect(snapTime(time, 15)).toBe(time)
    }
  })

  it('rounds the last quarter of the day without overflowing it', () => {
    expect(snapMinutes(1439, 15)).toBe(1440)
    // …and the clamp in minutesToTime keeps it inside the day.
    expect(snapTime('23:59', 15)).toBe('23:59')
  })

  it('supports other intervals through the same one function', () => {
    expect(snapTime('18:20', 30)).toBe('18:30')
    expect(snapTime('18:14', 30)).toBe('18:00')
    expect(snapMinutes(7, 0)).toBe(7)
  })
})

describe('calendar labels', () => {
  it('names a month and a full date', () => {
    expect(formatMonthLabel('2026-09-04')).toBe('September 2026')
    expect(formatMonthLabel('2027-01-31')).toBe('January 2027')
    expect(formatFullDate('2026-09-03')).toBe('Thursday, 3 Sep 2026')
  })
})
