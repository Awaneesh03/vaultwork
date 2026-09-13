import { describe, expect, it } from 'vitest'
import { datesBetween, weekdayOf } from './date'
import {
  CALENDAR_MODES,
  SNAP_MINUTES,
  axisHours,
  isCalendarMode,
  minuteFraction,
  monthGrid,
  monthGridRange,
  periodTitle,
  shiftPeriod,
  visibleRange,
  weekDates,
} from './calendar'

/**
 * The calendar's structure, with no database, no clock and no DOM.
 *
 * A month grid is pure arithmetic, so every awkward month — one that starts on
 * the week start, a February that fits exactly, a leap year, a year boundary —
 * is a plain assertion rather than something you have to click to find out.
 */

describe('modes', () => {
  it('recognises its own modes and nothing else', () => {
    for (const mode of CALENDAR_MODES) expect(isCalendarMode(mode)).toBe(true)
    expect(isCalendarMode('year')).toBe(false)
    expect(isCalendarMode('')).toBe(false)
  })
})

describe('the month grid', () => {
  const flat = (anchor: string, start: 0 | 1) => monthGrid(anchor, start).flat()

  it('is built from whole weeks that start on the chosen day', () => {
    for (const start of [0, 1] as const) {
      for (const row of monthGrid('2026-09-15', start)) {
        expect(row).toHaveLength(7)
        expect(weekdayOf(row[0]!)).toBe(start)
      }
    }
  })

  it('covers every day of the month it was asked for', () => {
    const cells = new Set(flat('2026-09-15', 1))
    for (const date of datesBetween('2026-09-01', '2026-09-30')) {
      expect(cells.has(date)).toBe(true)
    }
  })

  it('is contiguous, with no repeated or missing day', () => {
    const cells = flat('2026-09-15', 1)
    expect(new Set(cells).size).toBe(cells.length)
    expect(cells).toEqual(datesBetween(cells[0]!, cells[cells.length - 1]!))
  })

  it('pads with the neighbouring months at both ends', () => {
    // September 2026 starts on a Tuesday, so a Monday-start grid opens on
    // 31 August and runs to Sunday 4 October.
    const rows = monthGrid('2026-09-15', 1)
    expect(rows[0]?.[0]).toBe('2026-08-31')
    expect(rows[rows.length - 1]?.[6]).toBe('2026-10-04')
  })

  it('shifts by one day when the week starts on Sunday instead', () => {
    const rows = monthGrid('2026-09-15', 0)
    expect(rows[0]?.[0]).toBe('2026-08-30')
    expect(rows[rows.length - 1]?.[6]).toBe('2026-10-03')
  })

  it('uses only four rows for a February that fits exactly', () => {
    // February 2027 has 28 days and begins on a Monday — a Monday-start grid
    // needs exactly four weeks and no padding at all.
    const rows = monthGrid('2027-02-15', 1)
    expect(rows).toHaveLength(4)
    expect(rows[0]?.[0]).toBe('2027-02-01')
    expect(rows[3]?.[6]).toBe('2027-02-28')
  })

  it('uses six rows for a long month that starts late in the week', () => {
    // May 2027 has 31 days and begins on a Saturday.
    const rows = monthGrid('2027-05-15', 1)
    expect(rows).toHaveLength(6)
  })

  it('includes 29 February in a leap year', () => {
    expect(new Set(flat('2028-02-10', 1)).has('2028-02-29')).toBe(true)
    expect(new Set(flat('2026-02-10', 1)).has('2026-02-29')).toBe(false)
  })

  it('crosses a year boundary in both directions', () => {
    const december = new Set(flat('2026-12-15', 1))
    expect(december.has('2026-12-31')).toBe(true)
    expect(december.has('2027-01-01')).toBe(true)

    const january = new Set(flat('2027-01-15', 1))
    expect(january.has('2026-12-31')).toBe(true)
    expect(january.has('2027-01-01')).toBe(true)
  })

  it('reports the same range it renders', () => {
    for (const anchor of ['2026-09-15', '2027-02-15', '2027-05-15', '2026-12-15']) {
      const cells = monthGrid(anchor, 1).flat()
      const range = monthGridRange(anchor, 1)
      expect(range.from).toBe(cells[0])
      expect(range.to).toBe(cells[cells.length - 1])
    }
  })
})

describe('the week', () => {
  it('is seven consecutive days from the week start', () => {
    const days = weekDates('2026-09-03', 1)
    expect(days).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ])
  })

  it('follows the Sunday convention when that is the setting', () => {
    expect(weekDates('2026-09-03', 0)[0]).toBe('2026-08-30')
  })

  it('spans a month boundary without a gap', () => {
    const days = weekDates('2026-10-01', 1)
    expect(days[0]).toBe('2026-09-28')
    expect(days[6]).toBe('2026-10-04')
  })
})

describe('the visible range', () => {
  it('is the whole padded grid for a month', () => {
    expect(visibleRange('month', '2026-09-15', 1)).toEqual({
      from: '2026-08-31',
      to: '2026-10-04',
    })
  })

  it('is exactly the week for a week', () => {
    expect(visibleRange('week', '2026-09-03', 1)).toEqual({
      from: '2026-08-31',
      to: '2026-09-06',
    })
  })

  it('is the single day for a day', () => {
    expect(visibleRange('day', '2026-09-03', 1)).toEqual({
      from: '2026-09-03',
      to: '2026-09-03',
    })
  })
})

describe('navigation', () => {
  it('moves a month at a time in month mode', () => {
    expect(shiftPeriod('month', '2026-09-15', 1)).toBe('2026-10-15')
    expect(shiftPeriod('month', '2026-09-15', -1)).toBe('2026-08-15')
  })

  it('does not skip February when stepping from the 31st', () => {
    expect(shiftPeriod('month', '2026-01-31', 1)).toBe('2026-02-28')
  })

  it('moves a week at a time in week mode', () => {
    expect(shiftPeriod('week', '2026-09-03', 1)).toBe('2026-09-10')
    expect(shiftPeriod('week', '2026-09-03', -1)).toBe('2026-08-27')
  })

  it('moves a day at a time in day mode, across a year boundary', () => {
    expect(shiftPeriod('day', '2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftPeriod('day', '2027-01-01', -1)).toBe('2026-12-31')
  })

  it('is reversible in every mode', () => {
    for (const mode of CALENDAR_MODES) {
      const there = shiftPeriod(mode, '2026-09-15', 1)
      expect(shiftPeriod(mode, there, -1)).toBe('2026-09-15')
    }
  })
})

describe('period titles', () => {
  it('names the month', () => {
    expect(periodTitle('month', '2026-09-15', 1)).toBe('September 2026')
  })

  it('names a week inside one month with a single month name', () => {
    expect(periodTitle('week', '2026-09-10', 1)).toBe('7 – 13 September 2026')
  })

  it('names both months when the week straddles one', () => {
    expect(periodTitle('week', '2026-09-03', 1)).toBe('31 Aug – 6 Sep 2026')
  })

  it('names both years when the week straddles one', () => {
    expect(periodTitle('week', '2026-12-31', 1)).toBe('28 Dec 2026 – 3 Jan 2027')
  })

  it('names the full date in day mode', () => {
    expect(periodTitle('day', '2026-09-03', 1)).toBe('Thursday, 3 Sep 2026')
  })
})

describe('time placement', () => {
  it('draws every hour of the local day', () => {
    const hours = axisHours()
    expect(hours).toHaveLength(24)
    expect(hours[0]).toBe(0)
    expect(hours[23]).toBe(23)
  })

  it('places a minute as a fraction of the day', () => {
    expect(minuteFraction(0)).toBe(0)
    expect(minuteFraction(12 * 60)).toBeCloseTo(0.5, 5)
    // 19:00 is 19/24 of the way down the axis — this is what "a task at 19:00
    // appears at 19:00" means, expressed without pixels.
    expect(minuteFraction(19 * 60)).toBeCloseTo(19 / 24, 5)
  })

  it('clamps anything outside the day into it', () => {
    expect(minuteFraction(-60)).toBe(0)
    expect(minuteFraction(48 * 60)).toBe(1)
  })

  it('uses one snap interval everywhere', () => {
    expect(SNAP_MINUTES).toBe(15)
  })
})
