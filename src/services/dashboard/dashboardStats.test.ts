import { describe, expect, it } from 'vitest'
import { GREETINGS } from '@/features/dashboard/greeting'
import { toInstant } from '@/lib/date'
import type { AppEvent, Task } from '@/types/entities'
import { taskInput } from '../../../tests/factories'
import {
  GREETING_KEYS,
  bucketFor,
  compareForNextAction,
  completedOn,
  completedOnDay,
  describeEvent,
  eventSubject,
  greetingFor,
  headlineFor,
  rankForNextAction,
  selectNextAction,
} from './dashboardStats'

/**
 * The Dashboard's rules, tested against plain arrays with a pinned date.
 *
 * The suite runs under TZ=Asia/Kolkata (UTC+05:30), which is what makes the
 * local-day tests meaningful: under TZ=UTC a naive `toISOString().slice(0,10)`
 * implementation would pass every one of them.
 */

const TODAY = '2026-09-03'
const YESTERDAY = '2026-09-02'
const TOMORROW = '2026-09-04'

let seq = 0

function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    ...taskInput(),
    id: `task-${String(seq).padStart(3, '0')}`,
    createdAt: seq,
    updatedAt: seq,
    deletedAt: null,
    ...overrides,
  } as Task
}

describe('greetingFor', () => {
  it('splits the day at the documented boundaries', () => {
    expect(greetingFor(0)).toBe('lateNight')
    expect(greetingFor(4)).toBe('lateNight')
    expect(greetingFor(5)).toBe('morning')
    expect(greetingFor(11)).toBe('morning')
    expect(greetingFor(12)).toBe('afternoon')
    expect(greetingFor(16)).toBe('afternoon')
    expect(greetingFor(17)).toBe('evening')
    expect(greetingFor(23)).toBe('evening')
  })

  it('has a label for every greeting the service can return', () => {
    // The service picks the key, the feature layer words it. This is what keeps
    // the two in step across the layer boundary.
    for (const key of GREETING_KEYS) {
      expect(GREETINGS[key]).toBeTruthy()
    }
    expect(Object.keys(GREETINGS).sort()).toEqual([...GREETING_KEYS].sort())
  })
})

describe('completed today, in local time', () => {
  it('ignores a task that is not actually done', () => {
    expect(completedOn(task({ status: 'todo', completedAt: 123 }))).toBeNull()
    expect(completedOn(task({ status: 'done', completedAt: null }))).toBeNull()
  })

  it('counts a completion at one minute past local midnight as today', () => {
    const at = toInstant(TODAY, '00:00')
    expect(completedOn(task({ status: 'done', completedAt: at + 60_000 }))).toBe(TODAY)
  })

  it('counts a completion at 23:59 local as today, not tomorrow', () => {
    // This is the case a UTC-based implementation gets wrong: 23:59 in
    // UTC+05:30 is 18:29 UTC on the same day, but 00:30 local becomes the
    // *previous* UTC day, and the naive version drifts in one direction only.
    expect(completedOn(task({ status: 'done', completedAt: toInstant(TODAY, '23:59') }))).toBe(
      TODAY,
    )
  })

  it('puts one millisecond before local midnight on the previous day', () => {
    const midnight = toInstant(TODAY, '00:00')
    expect(completedOn(task({ status: 'done', completedAt: midnight - 1 }))).toBe(YESTERDAY)
    expect(completedOn(task({ status: 'done', completedAt: midnight }))).toBe(TODAY)
  })

  it('puts the last instant of the day on that day, and the next on the next', () => {
    const nextMidnight = toInstant(TOMORROW, '00:00')
    expect(completedOn(task({ status: 'done', completedAt: nextMidnight - 1 }))).toBe(TODAY)
    expect(completedOn(task({ status: 'done', completedAt: nextMidnight }))).toBe(TOMORROW)
  })

  it('selects only the tasks finished on the day asked for', () => {
    const rows = [
      task({ status: 'done', completedAt: toInstant(TODAY, '09:00') }),
      task({ status: 'done', completedAt: toInstant(TODAY, '23:30') }),
      task({ status: 'done', completedAt: toInstant(YESTERDAY, '23:30') }),
      task({ status: 'todo' }),
    ]
    expect(completedOnDay(rows, TODAY)).toHaveLength(2)
    expect(completedOnDay(rows, YESTERDAY)).toHaveLength(1)
  })
})

describe('next action buckets', () => {
  it('sorts a task into overdue, today, scheduled or undated', () => {
    expect(bucketFor(task({ dueDate: YESTERDAY }), TODAY)).toBe('overdue')
    expect(bucketFor(task({ dueDate: TODAY }), TODAY)).toBe('today')
    expect(bucketFor(task({ dueDate: TOMORROW }), TODAY)).toBe('scheduled')
    expect(bucketFor(task({ dueDate: null }), TODAY)).toBe('undated')
  })
})

describe('the next action rule', () => {
  const pick = (tasks: Task[]) => selectNextAction(tasks, TODAY)?.title

  it('returns null when nothing is open', () => {
    expect(selectNextAction([], TODAY)).toBeNull()
    expect(selectNextAction([task({ status: 'done' })], TODAY)).toBeNull()
  })

  it('prefers overdue over everything, whatever its priority', () => {
    const rows = [
      task({ title: 'urgent today', dueDate: TODAY, priority: 'urgent' }),
      task({ title: 'low but late', dueDate: YESTERDAY, priority: 'low' }),
    ]
    // Time first, importance second: an urgent thing due later is still later.
    expect(pick(rows)).toBe('low but late')
  })

  it('prefers today over a future date', () => {
    const rows = [
      task({ title: 'urgent tomorrow', dueDate: TOMORROW, priority: 'urgent' }),
      task({ title: 'plain today', dueDate: TODAY }),
    ]
    expect(pick(rows)).toBe('plain today')
  })

  it('prefers a dated task over an undated one', () => {
    const rows = [
      task({ title: 'someday', dueDate: null, priority: 'urgent' }),
      task({ title: 'next week', dueDate: '2026-09-10' }),
    ]
    expect(pick(rows)).toBe('next week')
  })

  it('breaks a bucket tie on priority', () => {
    const rows = [
      task({ title: 'medium', dueDate: TODAY, priority: 'medium' }),
      task({ title: 'urgent', dueDate: TODAY, priority: 'urgent' }),
      task({ title: 'high', dueDate: TODAY, priority: 'high' }),
    ]
    expect(pick(rows)).toBe('urgent')
  })

  it('breaks a priority tie on the earlier due date', () => {
    const rows = [
      task({ title: 'later', dueDate: '2026-09-20', priority: 'high' }),
      task({ title: 'sooner', dueDate: '2026-09-10', priority: 'high' }),
    ]
    expect(pick(rows)).toBe('sooner')
  })

  it('breaks a date tie on the earlier due time, untimed last', () => {
    const rows = [
      task({ title: 'evening', dueDate: TODAY, dueTime: '19:00' }),
      task({ title: 'anytime', dueDate: TODAY, dueTime: null }),
      task({ title: 'morning', dueDate: TODAY, dueTime: '08:00' }),
    ]
    expect(pick(rows)).toBe('morning')
    expect(rankForNextAction(rows, TODAY).map((row) => row.title)).toEqual([
      'morning',
      'evening',
      'anytime',
    ])
  })

  it('prefers filed work over unfiled, all else equal', () => {
    const rows = [
      task({ title: 'inbox', dueDate: TODAY, projectId: null, sortOrder: 1000 }),
      task({ title: 'filed', dueDate: TODAY, projectId: 'project-1', sortOrder: 1000 }),
    ]
    expect(pick(rows)).toBe('filed')
  })

  it('falls back to manual order, then age, then id', () => {
    const rows = [
      task({ title: 'second', dueDate: TODAY, sortOrder: 2000 }),
      task({ title: 'first', dueDate: TODAY, sortOrder: 1000 }),
    ]
    expect(pick(rows)).toBe('first')

    const sameOrder = [
      task({ title: 'newer', dueDate: TODAY, sortOrder: 1000, createdAt: 500 }),
      task({ title: 'older', dueDate: TODAY, sortOrder: 1000, createdAt: 100 }),
    ]
    expect(pick(sameOrder)).toBe('older')
  })

  it('is a total order — the answer cannot depend on row order', () => {
    const rows = [
      task({ title: 'a', dueDate: TODAY, sortOrder: 1000, createdAt: 1, id: 'id-b' } as Partial<Task>),
      task({ title: 'b', dueDate: TODAY, sortOrder: 1000, createdAt: 1, id: 'id-a' } as Partial<Task>),
    ]
    expect(pick(rows)).toBe('b')
    expect(pick([...rows].reverse())).toBe('b')
  })

  it('is antisymmetric, so sorting with it is well defined', () => {
    const rows = [
      task({ title: 'late', dueDate: YESTERDAY, priority: 'low' }),
      task({ title: 'today urgent', dueDate: TODAY, priority: 'urgent' }),
      task({ title: 'today plain', dueDate: TODAY, projectId: 'p1' }),
      task({ title: 'future', dueDate: TOMORROW }),
      task({ title: 'undated' }),
    ]

    for (const a of rows) {
      // A task is never better than itself…
      expect(compareForNextAction(a, a, TODAY)).toBe(0)
      for (const b of rows) {
        if (a === b) continue
        const forward = compareForNextAction(a, b, TODAY)
        const backward = compareForNextAction(b, a, TODAY)
        // …and exactly one of any two distinct tasks wins.
        expect(forward).not.toBe(0)
        expect(Math.sign(forward)).toBe(-Math.sign(backward))
      }
    }
  })

  it('never returns a completed task', () => {
    const rows = [
      task({ title: 'done and late', status: 'done', dueDate: YESTERDAY }),
      task({ title: 'open', dueDate: TOMORROW }),
    ]
    expect(pick(rows)).toBe('open')
  })

  it('ranks the same way it selects', () => {
    const rows = [
      task({ title: 'undated' }),
      task({ title: 'future', dueDate: TOMORROW }),
      task({ title: 'today', dueDate: TODAY }),
      task({ title: 'late', dueDate: YESTERDAY }),
    ]
    const ranked = rankForNextAction(rows, TODAY)
    expect(ranked.map((row) => row.title)).toEqual(['late', 'today', 'future', 'undated'])
    expect(selectNextAction(rows, TODAY)?.title).toBe(ranked[0]?.title)
  })
})

describe('the headline', () => {
  const base = { open: 0, dueToday: 0, overdue: 0, completedToday: 0 }

  it('reports both figures when both exist', () => {
    expect(headlineFor({ ...base, dueToday: 2, overdue: 1 })).toBe(
      'You have 2 tasks due today and 1 overdue.',
    )
  })

  it('reports one figure on its own', () => {
    expect(headlineFor({ ...base, dueToday: 1 })).toBe('You have 1 task due today.')
    expect(headlineFor({ ...base, overdue: 3 })).toBe('You have 3 overdue.')
  })

  it('mentions what was finished when nothing is due', () => {
    expect(headlineFor({ ...base, completedToday: 4 })).toBe(
      'Nothing due today. 4 tasks finished so far.',
    )
  })

  it('mentions undated work when there is nothing else to say', () => {
    expect(headlineFor({ ...base, open: 5 })).toBe(
      'Nothing due today. 5 open tasks without a date.',
    )
  })

  it('says the plain thing on an empty database', () => {
    expect(headlineFor(base)).toBe('Nothing due today.')
  })
})

describe('event descriptions', () => {
  const event = (overrides: Partial<AppEvent> = {}): AppEvent => ({
    id: 'event-1',
    type: 'task.created',
    at: 1_000,
    entityType: 'task',
    entityId: 'task-1',
    source: 'ui',
    payload: null,
    ...overrides,
  })

  it('prefers the name the event recorded at the time', () => {
    const completed = event({ type: 'task.completed', payload: { title: 'Study Java' } })
    // The payload is what was true then; the row may since have been renamed.
    expect(eventSubject(completed, 'Renamed Later')).toBe('Study Java')
    expect(describeEvent(completed, 'Renamed Later')).toBe('Completed Study Java')
  })

  it('falls back to the resolved row when the event carries no name', () => {
    expect(describeEvent(event(), 'Fix login bug')).toBe('Added Fix login bug')
  })

  it('reads projects with their own verbs', () => {
    const created = event({ type: 'project.created', entityType: 'project' })
    expect(describeEvent(created, 'College')).toBe('Created project College')
    expect(describeEvent(event({ type: 'project.updated' }), 'College')).toBe(
      'Updated project College',
    )
    expect(describeEvent(event({ type: 'project.archived' }), 'College')).toBe(
      'Archived project College',
    )
  })

  it('degrades to the verb alone rather than printing "undefined"', () => {
    expect(describeEvent(event({ type: 'task.completed' }), null)).toBe('Completed')
  })

  it('falls back to the raw type for an event it has no wording for', () => {
    expect(describeEvent(event({ type: 'habit.checked' }), 'Read')).toBe('habit.checked Read')
  })

  it('reads a name payload as well as a title payload', () => {
    const archived = event({ type: 'project.archived', payload: { name: 'College', from: 'active' } })
    expect(describeEvent(archived, null)).toBe('Archived project College')
  })
})
