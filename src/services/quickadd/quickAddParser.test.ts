import { afterEach, describe, expect, it, vi } from 'vitest'
import { freezeClock } from '../../../tests/helpers'
import { consumedRanges, parseQuickAdd } from './quickAddParser'

/**
 * The parser is pure and clock-injected, so every date case is pinned to a
 * known "now" rather than to whenever the suite happens to run.
 *
 * NOW is Thursday 3 September 2026. Chosen deliberately: mid-week, so weekday
 * arithmetic has to wrap in both directions, and mid-month, so a bare "12 sep"
 * still falls in the current year while "1 sep" has to roll to the next one.
 */
const NOW = new Date(2026, 8, 3, 10, 0, 0)
const parse = (input: string) => parseQuickAdd(input, { now: NOW })

describe('the worked example from the specification', () => {
  const input = 'Study Java tomorrow at 7pm #college #java !high @DSA ~45m'
  const result = parse(input)

  it('extracts the title and nothing else', () => {
    expect(result.draft.title).toBe('Study Java')
  })

  it('reads the date, the time and the estimate', () => {
    expect(result.draft.dueDate).toBe('2026-09-04')
    expect(result.draft.dueTime).toBe('19:00')
    expect(result.draft.estimateMin).toBe(45)
  })

  it('reads the tags, the priority and the project', () => {
    expect(result.draft.tagNames).toEqual(['college', 'java'])
    expect(result.draft.priority).toBe('high')
    expect(result.draft.projectName).toBe('DSA')
  })

  it('reports a consumed range for every recognised token', () => {
    expect(result.tokens.map((token) => token.kind)).toEqual([
      'date',
      'time',
      'tag',
      'tag',
      'priority',
      'project',
      'estimate',
    ])
  })

  it('gives ranges that map back onto the original text', () => {
    for (const token of result.tokens) {
      expect(input.slice(token.start, token.end)).toBe(token.text)
    }
    // "at 7pm" is consumed as one span, the preposition included.
    const time = result.tokens.find((token) => token.kind === 'time')
    expect(time?.text).toBe('at 7pm')
  })

  it('leaves the title characters unconsumed', () => {
    const ranges = consumedRanges(result)
    const covered = new Set<number>()
    for (const range of ranges) {
      for (let i = range.start; i < range.end; i += 1) covered.add(i)
    }
    expect(covered.has(0)).toBe(false)
    expect(covered.has(input.indexOf('#college'))).toBe(true)
  })
})

describe('dates', () => {
  const dueDate = (input: string) => parse(input).draft.dueDate

  it('reads today and tomorrow', () => {
    expect(dueDate('Pay fees today')).toBe('2026-09-03')
    expect(dueDate('Pay fees tomorrow')).toBe('2026-09-04')
    expect(dueDate('Pay fees tmr')).toBe('2026-09-04')
  })

  it('reads a bare weekday as the next one on or after today', () => {
    // NOW is a Thursday.
    expect(dueDate('Gym fri')).toBe('2026-09-04')
    expect(dueDate('Gym sunday')).toBe('2026-09-06')
    expect(dueDate('Gym mon')).toBe('2026-09-07')
    expect(dueDate('Gym thu')).toBe('2026-09-03')
  })

  it('reads "next <weekday>" as strictly after today', () => {
    expect(dueDate('Gym next thu')).toBe('2026-09-10')
    expect(dueDate('Gym next mon')).toBe('2026-09-07')
  })

  it('reads next week', () => {
    expect(dueDate('Review next week')).toBe('2026-09-10')
  })

  it('reads "in N days" and "in N weeks"', () => {
    expect(dueDate('Follow up in 3 days')).toBe('2026-09-06')
    expect(dueDate('Follow up in 2 weeks')).toBe('2026-09-17')
    expect(dueDate('Follow up in 1 month')).toBe('2026-10-03')
  })

  it('reads a day and a month in either order', () => {
    expect(dueDate('Exam 12 sep')).toBe('2026-09-12')
    expect(dueDate('Exam sep 12')).toBe('2026-09-12')
    expect(dueDate('Exam 12 september')).toBe('2026-09-12')
  })

  it('reads a day-first numeric date', () => {
    expect(dueDate('Exam 12/09')).toBe('2026-09-12')
    expect(dueDate('Exam 12/09/2027')).toBe('2027-09-12')
    expect(dueDate('Exam 2026-12-09')).toBe('2026-12-09')
  })

  it('rolls a yearless date forward rather than into the past', () => {
    // 1 September has already gone by on 3 September.
    expect(dueDate('Exam 1 sep')).toBe('2027-09-01')
    expect(dueDate('Exam 12/08')).toBe('2027-08-12')
  })

  it('swallows a leading preposition with the date', () => {
    const result = parse('Submit report by friday')
    expect(result.draft.title).toBe('Submit report')
    expect(result.draft.dueDate).toBe('2026-09-04')
  })

  it('rejects an impossible date and keeps it in the title', () => {
    const result = parse('Exam 31/02')
    expect(result.draft.dueDate).toBeNull()
    expect(result.draft.title).toBe('Exam 31/02')
  })

  it('lets a later date correct an earlier one', () => {
    const result = parse('Call tomorrow mon')
    expect(result.draft.dueDate).toBe('2026-09-07')
    expect(result.draft.title).toBe('Call')
  })
})

describe('times', () => {
  const dueTime = (input: string) => parse(input).draft.dueTime

  it('reads a 12-hour clock', () => {
    expect(dueTime('Call 7pm')).toBe('19:00')
    expect(dueTime('Call 7am')).toBe('07:00')
    expect(dueTime('Call 7.30pm')).toBe('19:30')
    expect(dueTime('Call 7:30am')).toBe('07:30')
  })

  it('reads a 24-hour clock', () => {
    expect(dueTime('Call 19:00')).toBe('19:00')
    expect(dueTime('Call 09:05')).toBe('09:05')
  })

  it('reads noon and midnight', () => {
    expect(dueTime('Call noon')).toBe('12:00')
    expect(dueTime('Call midnight')).toBe('00:00')
  })

  it('gets the twelve-o-clock boundaries right', () => {
    expect(dueTime('Call 12pm')).toBe('12:00')
    expect(dueTime('Call 12am')).toBe('00:00')
  })

  it('does not eat a bare number, which is usually part of the title', () => {
    const result = parse('Solve 3 array problems')
    expect(result.draft.dueTime).toBeNull()
    expect(result.draft.title).toBe('Solve 3 array problems')
  })

  it('rejects an impossible time and keeps it in the title', () => {
    const result = parse('Call 25:00')
    expect(result.draft.dueTime).toBeNull()
    expect(result.draft.title).toBe('Call 25:00')
  })

  it('leaves a stranded preposition alone', () => {
    const result = parse('Look at the notes')
    expect(result.draft.title).toBe('Look at the notes')
    expect(result.draft.dueTime).toBeNull()
  })
})

describe('priority', () => {
  const priority = (input: string) => parse(input).draft.priority

  it('reads every level in the grammar', () => {
    expect(priority('a !none')).toBe('none')
    expect(priority('a !low')).toBe('low')
    expect(priority('a !med')).toBe('medium')
    expect(priority('a !medium')).toBe('medium')
    expect(priority('a !high')).toBe('high')
    expect(priority('a !urgent')).toBe('urgent')
  })

  it('is case-insensitive', () => {
    expect(priority('a !HIGH')).toBe('high')
  })

  it('defaults to none', () => {
    expect(priority('Just a task')).toBe('none')
  })
})

describe('project and tags', () => {
  it('reads a project and preserves its casing for matching', () => {
    expect(parse('Study @DSA').draft.projectName).toBe('DSA')
  })

  it('lowercases tags, because tag names are unique', () => {
    expect(parse('Study #Java #JAVA #college').draft.tagNames).toEqual(['java', 'college'])
  })

  it('accepts hyphens and digits inside a tag', () => {
    expect(parse('Read #deep-work #cs101').draft.tagNames).toEqual(['deep-work', 'cs101'])
  })
})

describe('estimates', () => {
  const estimate = (input: string) => parse(input).draft.estimateMin

  it('reads minutes and hours', () => {
    expect(estimate('a ~30m')).toBe(30)
    expect(estimate('a ~45m')).toBe(45)
    expect(estimate('a ~2h')).toBe(120)
    expect(estimate('a ~90')).toBe(90)
    expect(estimate('a ~1.5h')).toBe(90)
  })

  it('accepts the long unit spellings', () => {
    expect(estimate('a ~20mins')).toBe(20)
    expect(estimate('a ~3hrs')).toBe(180)
  })

  it('rejects a zero estimate', () => {
    const result = parse('a ~0m')
    expect(result.draft.estimateMin).toBeNull()
    expect(result.draft.title).toBe('a ~0m')
  })
})

describe('unknown tokens are never discarded', () => {
  it('keeps an unrecognised priority in the title and reports it', () => {
    const result = parse('Study Java !nope')
    expect(result.draft.title).toBe('Study Java !nope')
    expect(result.draft.priority).toBe('none')
    expect(result.unknown).toEqual(['!nope'])
  })

  it('keeps an unrecognised estimate in the title', () => {
    const result = parse('Study Java ~soon')
    expect(result.draft.title).toBe('Study Java ~soon')
    expect(result.draft.estimateMin).toBeNull()
    expect(result.unknown).toEqual(['~soon'])
  })

  it('keeps a bare sigil in the title', () => {
    const result = parse('Email # and @ and !')
    expect(result.draft.title).toBe('Email # and @ and !')
    expect(result.unknown).toEqual([])
  })

  it('keeps ordinary words that merely look structural', () => {
    const result = parse('Read chapter 4 of Designing Data-Intensive Applications')
    expect(result.draft.title).toBe('Read chapter 4 of Designing Data-Intensive Applications')
    expect(result.draft.dueDate).toBeNull()
  })

  it('preserves an e-mail address rather than reading it as a project', () => {
    const result = parse('Mail prof@college.edu about the lab')
    expect(result.draft.title).toBe('Mail prof@college.edu about the lab')
    expect(result.draft.projectName).toBeNull()
  })
})

describe('title assembly', () => {
  it('collapses the whitespace the removed tokens left behind', () => {
    const result = parse('  Study   Java   tomorrow   #java  ')
    expect(result.draft.title).toBe('Study Java')
  })

  it('produces an empty title when the input is only syntax', () => {
    const result = parse('#java !high tomorrow')
    expect(result.draft.title).toBe('')
    expect(result.draft.tagNames).toEqual(['java'])
  })

  it('handles an empty input', () => {
    const result = parse('')
    expect(result.draft.title).toBe('')
    expect(result.tokens).toEqual([])
  })
})

describe('description separator', () => {
  it('takes everything after // as the description', () => {
    const result = parse('Study Java tomorrow // traversals first, then BST insert')
    expect(result.draft.title).toBe('Study Java')
    expect(result.draft.dueDate).toBe('2026-09-04')
    expect(result.draft.description).toBe('traversals first, then BST insert')
  })

  it('does not tokenise the description, so notes may contain sigils', () => {
    const result = parse('Study // see #chapter4 at 7pm')
    expect(result.draft.title).toBe('Study')
    expect(result.draft.tagNames).toEqual([])
    expect(result.draft.dueTime).toBeNull()
    expect(result.draft.description).toBe('see #chapter4 at 7pm')
  })

  it('leaves a // inside a word alone', () => {
    const result = parse('Read https://example.com/docs')
    expect(result.draft.title).toBe('Read https://example.com/docs')
    expect(result.draft.description).toBeNull()
  })
})

describe('determinism', () => {
  it('gives the same answer for the same input and clock', () => {
    const input = 'Revise graphs next mon at 6.30pm #dsa !urgent @DSA ~2h // BFS and DFS'
    expect(parse(input)).toEqual(parse(input))
  })
})

describe('the default clock', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves a relative date through the clock port, not the system clock', () => {
    // Every UI path parses without an explicit `now`. Pinning the port has to
    // pin the parser too, or "tomorrow" means one thing on screen and another
    // in the row that gets written.
    freezeClock(new Date(2026, 8, 3, 10, 0, 0))
    expect(parseQuickAdd('Study Java tomorrow').draft.dueDate).toBe('2026-09-04')

    freezeClock(new Date(2027, 0, 31, 10, 0, 0))
    expect(parseQuickAdd('Study Java tomorrow').draft.dueDate).toBe('2027-02-01')
  })

  it('still lets a caller inject its own date', () => {
    freezeClock(new Date(2026, 8, 3, 10, 0, 0))
    const parse = parseQuickAdd('Study Java tomorrow', { now: new Date(2026, 11, 24, 9, 0, 0) })
    expect(parse.draft.dueDate).toBe('2026-12-25')
  })
})
