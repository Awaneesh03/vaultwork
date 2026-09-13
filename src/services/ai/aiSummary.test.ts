import { describe, expect, it } from 'vitest'
import type { Id } from '@/types/entities'
import type { CommandIntent } from '../commands/intents'
import { describeAiIntent, targetIdsOf } from './aiSummary'

/**
 * What the user reads before saying yes.
 *
 * The property under test is not "does it read nicely" but "is it derived from
 * the command that will actually run". A summary that came from the model's own
 * description would let a reply narrate one thing and do another, which is the
 * ordinary failure mode of asking a model to describe its own actions.
 */

const TODAY = '2026-09-06'
const TITLES = new Map<Id, string>([
  ['task-1' as Id, 'Study Java'],
  ['task-2' as Id, 'Revise recursion'],
])

const complete = (id: string): CommandIntent => ({
  kind: 'task.complete',
  source: 'ai',
  raw: 'Complete my Java task',
  ref: { by: 'id', id },
})

const reschedule = (id: string, dueDate: string | null, dueTime: string | null): CommandIntent => ({
  kind: 'task.reschedule',
  source: 'ai',
  raw: 'Move it',
  ref: { by: 'id', id },
  dueDate,
  dueTime,
})

const add = (
  overrides: Partial<{
    title: string
    dueDate: string | null
    dueTime: string | null
    priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
    projectName: string | null
    estimateMin: number | null
  }> = {},
): CommandIntent => ({
  kind: 'task.add',
  source: 'ai',
  raw: 'Add it',
  draft: {
    title: 'Study Java',
    description: null,
    dueDate: null,
    dueTime: null,
    priority: 'none',
    projectName: null,
    tagNames: [],
    estimateMin: null,
    subtasks: [],
    ...overrides,
  },
  tokens: [],
})

describe('completing a task', () => {
  it('names the task by its current title', () => {
    expect(describeAiIntent(complete('task-1'), TITLES, TODAY)).toBe('Complete task: “Study Java”')
  })

  it('shows no id when the task has gone', () => {
    // An id is useless to a person, and the honest answer is that the row is
    // missing. The executor will refuse it at confirm time anyway.
    const summary = describeAiIntent(complete('task-gone'), TITLES, TODAY)

    expect(summary).toBe('Complete task: (this task no longer exists)')
    expect(summary).not.toContain('task-gone')
  })

  it('never leaks an internal id, whatever the title', () => {
    expect(describeAiIntent(complete('task-1'), TITLES, TODAY)).not.toContain('task-1')
  })
})

describe('rescheduling a task', () => {
  it('says where the task is moving to, in the application’s own words', () => {
    expect(describeAiIntent(reschedule('task-1', '2026-09-07', '19:00'), TITLES, TODAY)).toBe(
      'Reschedule task: “Study Java” → Tomorrow at 7 pm',
    )
  })

  it('omits a time that was not given', () => {
    expect(describeAiIntent(reschedule('task-1', '2026-09-07', null), TITLES, TODAY)).toBe(
      'Reschedule task: “Study Java” → Tomorrow',
    )
  })

  it('uses the existing day labels rather than raw dates', () => {
    // `formatDayLabel`'s own three registers: a relative word, a bare weekday
    // inside the coming week, then a dated form. Reused rather than restated so
    // a proposal reads the way every other date in Vaultwork reads.
    expect(describeAiIntent(reschedule('task-1', '2026-09-06', null), TITLES, TODAY)).toContain(
      'Today',
    )
    expect(describeAiIntent(reschedule('task-2', '2026-09-12', null), TITLES, TODAY)).toContain(
      'Saturday',
    )
    expect(describeAiIntent(reschedule('task-2', '2026-09-13', null), TITLES, TODAY)).toContain(
      'Sun 13 Sep',
    )
  })

  it('says plainly when a reschedule would clear the date', () => {
    // Not reachable through the M15.2 parser, which refuses it — but if a
    // widened contract ever allowed it, the user must be told what it means.
    expect(describeAiIntent(reschedule('task-1', null, null), TITLES, TODAY)).toBe(
      'Clear the due date on “Study Java”',
    )
  })
})

describe('adding a task', () => {
  it('describes the title alone when nothing else is set', () => {
    expect(describeAiIntent(add(), TITLES, TODAY)).toBe('Add task: “Study Java”')
  })

  it('includes every field that will actually be applied', () => {
    const summary = describeAiIntent(
      add({
        dueDate: '2026-09-07',
        dueTime: '19:00',
        priority: 'high',
        projectName: 'DSA Mastery',
        estimateMin: 45,
      }),
      TITLES,
      TODAY,
    )

    expect(summary).toBe(
      'Add task: “Study Java” · Tomorrow at 7 pm · high priority · in “DSA Mastery” · 45m',
    )
  })

  it('says nothing about a project when none was proposed', () => {
    expect(describeAiIntent(add({ priority: 'low' }), TITLES, TODAY)).toBe(
      'Add task: “Study Java” · low priority',
    )
  })
})

describe('an intent it does not know how to describe', () => {
  it('admits it rather than guessing', () => {
    // Unreachable while the allowlist holds three kinds. If someone widens it
    // without writing a summary, the interface should say so — a confident but
    // wrong description of a mutation is the worst outcome available.
    const widened = {
      kind: 'task.delete',
      source: 'ai',
      raw: 'x',
      ref: { by: 'id', id: 'task-1' },
    } as unknown as CommandIntent

    expect(describeAiIntent(widened, TITLES, TODAY)).toBe(
      'Run task.delete (this action has no description yet)',
    )
  })
})

describe('collecting the targets a summary needs', () => {
  it('gathers ids from ref-carrying intents only', () => {
    expect(
      targetIdsOf([complete('task-1'), add(), reschedule('task-2', '2026-09-07', null)]),
    ).toEqual(['task-1', 'task-2'])
  })

  it('ignores a text reference, which has no id to fetch', () => {
    const unresolved = {
      kind: 'task.complete',
      source: 'ai',
      raw: 'x',
      ref: { by: 'text', query: 'Java' },
    } as CommandIntent

    expect(targetIdsOf([unresolved])).toEqual([])
  })
})
