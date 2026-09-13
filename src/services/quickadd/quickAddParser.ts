import { addDays, fromDateStr, todayStr } from '@/lib/date'
import { platform } from '@/platform'
import type { DateStr, TimeStr } from '@/types/entities'
import type { Priority } from '@/types/enums'

/**
 * The Quick Add grammar.
 *
 * Deterministic, pure, and clock-injected — no AI, no network, no `Date.now()`
 * hidden inside. The same input plus the same `now` always produces the same
 * draft, which is the only way this is testable at all.
 *
 *   Study Java tomorrow at 7pm #college #java !high @DSA ~45m
 *   └─ title ──┘ └─ date ──┘ └time┘ └── tags ──┘ └pri┘ └proj┘ └est┘
 *
 * The single most important property: **the title is assembled from the words
 * that were NOT consumed.** Unrecognised text cannot be dropped, because
 * dropping it would require a line of code that removes it, and there isn't
 * one. `!nope`, `~soon` and a bare `#` all survive into the title and are also
 * reported in `unknown` so the UI can say why they were ignored.
 *
 * Every match records the exact character range it consumed, so the input can
 * highlight what it understood while you type.
 *
 * Single-valued fields are last-wins: typing "tomorrow" and then correcting it
 * to "friday" means friday. Tags accumulate.
 */

export type QuickAddTokenKind =
  | 'date'
  | 'time'
  | 'tag'
  | 'project'
  | 'priority'
  | 'estimate'
  | 'description'

export interface QuickAddToken {
  kind: QuickAddTokenKind
  /** Character offset into the original input, inclusive. */
  start: number
  /** Character offset into the original input, exclusive. */
  end: number
  /** The exact source text that was consumed. */
  text: string
  /** The normalised value: a DateStr, a TimeStr, a Priority, minutes, a name. */
  value: string | number
}

/**
 * What a task-creating command carries. Names rather than ids: the parser is a
 * pure transform and knows nothing about what exists in the database. The
 * command executor resolves `projectName` and `tagNames` to rows.
 */
export interface TaskDraft {
  title: string
  description: string | null
  dueDate: DateStr | null
  dueTime: TimeStr | null
  priority: Priority
  projectName: string | null
  tagNames: string[]
  estimateMin: number | null
  subtasks: string[]
}

export interface QuickAddParse {
  draft: TaskDraft
  tokens: QuickAddToken[]
  /** Text that looked like syntax but was not understood. Stays in the title. */
  unknown: string[]
}

export function emptyDraft(): TaskDraft {
  return {
    title: '',
    description: null,
    dueDate: null,
    dueTime: null,
    priority: 'none',
    projectName: null,
    tagNames: [],
    estimateMin: null,
    subtasks: [],
  }
}

// ---------------------------------------------------------------- vocabulary

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

const PRIORITIES_BY_WORD: Record<string, Priority> = {
  none: 'none',
  low: 'low',
  med: 'medium',
  medium: 'medium',
  high: 'high',
  urgent: 'urgent',
}

/** Words that introduce a date and are swallowed with it. */
const DATE_PREFIXES = new Set(['on', 'by', 'due'])
/** Words that introduce a time and are swallowed with it. */
const TIME_PREFIXES = new Set(['at'])

// ------------------------------------------------------------------ scanning

interface Word {
  text: string
  lower: string
  start: number
  end: number
}

function scanWords(input: string): Word[] {
  const words: Word[] = []
  const re = /\S+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(input)) !== null) {
    words.push({
      text: match[0],
      lower: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return words
}

/** A matcher consumed `length` words and produced `value` of kind `kind`. */
interface Match {
  length: number
  kind: QuickAddTokenKind
  value: string | number
}

// ------------------------------------------------------------------- helpers

const pad = (n: number) => String(n).padStart(2, '0')

function dateFromParts(year: number, month: number, day: number): DateStr | null {
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * A day/month with no year means the *next* time that day comes round. "12 sep"
 * typed in November is next September, not ten months ago.
 */
function resolveYearless(month: number, day: number, today: DateStr): DateStr | null {
  const currentYear = Number(today.slice(0, 4))
  const thisYear = dateFromParts(currentYear, month, day)
  if (thisYear && thisYear >= today) return thisYear
  return dateFromParts(currentYear + 1, month, day)
}

/** Nearest `weekday` on or after today. "mon" on a Monday means today. */
function nearestWeekday(weekday: number, today: DateStr): DateStr {
  const offset = (weekday - fromDateStr(today).getDay() + 7) % 7
  return addDays(today, offset)
}

/** Strictly after today: "next mon" on a Monday means the Monday after. */
function followingWeekday(weekday: number, today: DateStr): DateStr {
  const nearest = nearestWeekday(weekday, today)
  return nearest === today ? addDays(nearest, 7) : nearest
}

function addMonths(value: DateStr, months: number): DateStr {
  const date = fromDateStr(value)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  // Clamp: 31 Jan + 1 month is 28/29 Feb, never 3 March.
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// ------------------------------------------------------------------ matchers

const NUMERIC_DATE_RE = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/
const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
const DAY_RE = /^(\d{1,2})(?:st|nd|rd|th)?$/
const YEAR_RE = /^\d{4}$/

function matchDate(words: Word[], i: number, today: DateStr): Match | null {
  const word = words[i]
  if (!word) return null

  // A leading "on" / "by" / "due" only counts if a date really follows.
  if (DATE_PREFIXES.has(word.lower)) {
    const inner = matchDate(words, i + 1, today)
    return inner ? { ...inner, length: inner.length + 1 } : null
  }

  const one = (value: DateStr): Match => ({ length: 1, kind: 'date', value })

  if (word.lower === 'today' || word.lower === 'tod') return one(today)
  if (word.lower === 'tomorrow' || word.lower === 'tmr' || word.lower === 'tmrw') {
    return one(addDays(today, 1))
  }
  if (word.lower === 'yesterday') return one(addDays(today, -1))

  // "next week" / "next month" / "next friday"
  if (word.lower === 'next' || word.lower === 'this') {
    const after = words[i + 1]
    if (after) {
      if (after.lower === 'week') {
        return { length: 2, kind: 'date', value: addDays(today, word.lower === 'next' ? 7 : 0) }
      }
      if (after.lower === 'month') {
        return { length: 2, kind: 'date', value: addMonths(today, word.lower === 'next' ? 1 : 0) }
      }
      const weekday = WEEKDAYS[after.lower]
      if (weekday !== undefined) {
        const value =
          word.lower === 'next' ? followingWeekday(weekday, today) : nearestWeekday(weekday, today)
        return { length: 2, kind: 'date', value }
      }
    }
  }

  // "in 3 days" / "in 2 weeks" / "in 1 month"
  if (word.lower === 'in') {
    const amount = words[i + 1]
    const unit = words[i + 2]
    const count = amount && /^\d+$/.test(amount.lower) ? Number(amount.lower) : NaN
    if (unit && Number.isFinite(count)) {
      if (/^days?$/.test(unit.lower)) return { length: 3, kind: 'date', value: addDays(today, count) }
      if (/^weeks?$/.test(unit.lower)) {
        return { length: 3, kind: 'date', value: addDays(today, count * 7) }
      }
      if (/^months?$/.test(unit.lower)) {
        return { length: 3, kind: 'date', value: addMonths(today, count) }
      }
    }
  }

  const bareWeekday = WEEKDAYS[word.lower]
  if (bareWeekday !== undefined) return one(nearestWeekday(bareWeekday, today))

  const iso = ISO_DATE_RE.exec(word.text)
  if (iso) {
    const value = dateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    if (value) return one(value)
  }

  // Day-first, matching the way the date is written by hand here: 12/09 is
  // 12 September. An explicit two-digit year is read as 20xx.
  const numeric = NUMERIC_DATE_RE.exec(word.text)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    const rawYear = numeric[3]
    if (rawYear === undefined) {
      const value = resolveYearless(month, day, today)
      if (value) return one(value)
    } else {
      const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)
      const value = dateFromParts(year, month, day)
      if (value) return one(value)
    }
  }

  const next = words[i + 1]

  // "12 sep" / "12 september 2026"
  const dayMatch = DAY_RE.exec(word.lower)
  if (dayMatch && next) {
    const month = MONTHS[next.lower]
    if (month !== undefined) {
      const day = Number(dayMatch[1])
      const yearWord = words[i + 2]
      if (yearWord && YEAR_RE.test(yearWord.lower)) {
        const value = dateFromParts(Number(yearWord.lower), month, day)
        if (value) return { length: 3, kind: 'date', value }
      }
      const value = resolveYearless(month, day, today)
      if (value) return { length: 2, kind: 'date', value }
    }
  }

  // "sep 12"
  const monthFirst = MONTHS[word.lower]
  if (monthFirst !== undefined && next) {
    const day = DAY_RE.exec(next.lower)
    if (day) {
      const yearWord = words[i + 2]
      if (yearWord && YEAR_RE.test(yearWord.lower)) {
        const value = dateFromParts(Number(yearWord.lower), monthFirst, Number(day[1]))
        if (value) return { length: 3, kind: 'date', value }
      }
      const value = resolveYearless(monthFirst, Number(day[1]), today)
      if (value) return { length: 2, kind: 'date', value }
    }
  }

  return null
}

const MERIDIEM_RE = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)$/
const CLOCK_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

function matchTime(words: Word[], i: number): Match | null {
  const word = words[i]
  if (!word) return null

  if (TIME_PREFIXES.has(word.lower)) {
    const inner = matchTime(words, i + 1)
    return inner ? { ...inner, length: inner.length + 1 } : null
  }

  const one = (value: TimeStr): Match => ({ length: 1, kind: 'time', value })

  if (word.lower === 'noon' || word.lower === 'midday') return one('12:00')
  if (word.lower === 'midnight') return one('00:00')

  const clock = CLOCK_RE.exec(word.text)
  if (clock) return one(`${pad(Number(clock[1]))}:${clock[2] as string}`)

  const meridiem = MERIDIEM_RE.exec(word.lower)
  if (meridiem) {
    let hour = Number(meridiem[1])
    const minute = meridiem[2] === undefined ? 0 : Number(meridiem[2])
    if (hour < 1 || hour > 12 || minute > 59) return null
    const isPm = (meridiem[3] as string).startsWith('p')
    if (isPm && hour !== 12) hour += 12
    if (!isPm && hour === 12) hour = 0
    return one(`${pad(hour)}:${pad(minute)}`)
  }

  return null
}

const TAG_RE = /^#([\p{L}\p{N}][\p{L}\p{N}_-]*)$/u
const PROJECT_RE = /^@([\p{L}\p{N}][\p{L}\p{N}_-]*)$/u
const PRIORITY_RE = /^!([a-z]+)$/
const ESTIMATE_RE = /^~(\d+(?:[.,]\d+)?)(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/

function matchSigil(words: Word[], i: number): Match | null {
  const word = words[i]
  if (!word) return null

  const tag = TAG_RE.exec(word.text)
  if (tag) return { length: 1, kind: 'tag', value: (tag[1] as string).toLowerCase() }

  const project = PROJECT_RE.exec(word.text)
  if (project) return { length: 1, kind: 'project', value: project[1] as string }

  const priority = PRIORITY_RE.exec(word.lower)
  if (priority) {
    const value = PRIORITIES_BY_WORD[priority[1] as string]
    // `!nope` is not a priority. Falling through leaves it in the title.
    if (value) return { length: 1, kind: 'priority', value }
  }

  const estimate = ESTIMATE_RE.exec(word.lower)
  if (estimate) {
    const amount = Number((estimate[1] as string).replace(',', '.'))
    const unit = estimate[2] ?? 'm'
    const minutes = Math.round(unit.startsWith('h') ? amount * 60 : amount)
    if (minutes > 0) return { length: 1, kind: 'estimate', value: minutes }
  }

  return null
}

/** True for text that used a sigil but did not parse — reported, never dropped. */
function looksLikeSyntax(word: Word): boolean {
  return /^[#@!~]/.test(word.text) && word.text.length > 1
}

// -------------------------------------------------------------------- parser

export interface QuickAddOptions {
  /** Injected so date words are deterministic in tests. */
  now?: Date
}

/**
 * The description separator. Everything after a standalone `//` is the
 * description and is never tokenised, so a note may contain `#` and `@` freely.
 */
const DESCRIPTION_SEPARATOR = '//'

function splitDescription(input: string): { head: string; description: string | null; at: number } {
  const re = /(^|\s)\/\/(\s|$)/
  const found = re.exec(input)
  if (!found) return { head: input, description: null, at: -1 }
  const at = found.index + (found[1] as string).length
  const head = input.slice(0, at)
  const body = input.slice(at + DESCRIPTION_SEPARATOR.length).trim()
  return { head, description: body.length > 0 ? body : null, at }
}

export function parseQuickAdd(input: string, options: QuickAddOptions = {}): QuickAddParse {
  // The default comes from the clock port, never from `new Date()`: the UI
  // paths (the live preview, and `parseCommand` without an explicit `now`)
  // supply no date of their own, and a parser that read the system clock would
  // make "tomorrow" mean something different from the rest of the application.
  const today = todayStr(options.now ?? new Date(platform.clock.now()))
  const { head, description, at } = splitDescription(input)

  const draft = emptyDraft()
  draft.description = description

  const tokens: QuickAddToken[] = []
  const unknown: string[] = []

  if (description !== null || at >= 0) {
    tokens.push({
      kind: 'description',
      start: at,
      end: input.length,
      text: input.slice(at),
      value: description ?? '',
    })
  }

  const words = scanWords(head)
  const kept: Word[] = []

  for (let i = 0; i < words.length; ) {
    const word = words[i] as Word
    const match = matchSigil(words, i) ?? matchDate(words, i, today) ?? matchTime(words, i)

    if (!match) {
      if (looksLikeSyntax(word)) unknown.push(word.text)
      kept.push(word)
      i += 1
      continue
    }

    const last = words[i + match.length - 1] as Word
    tokens.push({
      kind: match.kind,
      start: word.start,
      end: last.end,
      text: head.slice(word.start, last.end),
      value: match.value,
    })

    switch (match.kind) {
      case 'date':
        draft.dueDate = match.value as DateStr
        break
      case 'time':
        draft.dueTime = match.value as TimeStr
        break
      case 'priority':
        draft.priority = match.value as Priority
        break
      case 'estimate':
        draft.estimateMin = match.value as number
        break
      case 'project':
        draft.projectName = match.value as string
        break
      case 'tag': {
        const name = match.value as string
        if (!draft.tagNames.includes(name)) draft.tagNames.push(name)
        break
      }
      default:
        break
    }

    i += match.length
  }

  draft.title = kept.map((word) => word.text).join(' ')
  tokens.sort((a, b) => a.start - b.start)

  return { draft, tokens, unknown }
}

/** The character ranges a UI should highlight, merged and ordered. */
export function consumedRanges(parse: QuickAddParse): { start: number; end: number }[] {
  return parse.tokens
    .filter((token) => token.start >= 0)
    .map((token) => ({ start: token.start, end: token.end }))
}
