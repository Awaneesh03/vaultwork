import { describe, expect, it } from 'vitest'
import type { Goal, Milestone, Task } from '@/types/entities'
import { taskInput } from '../../../tests/factories'
import {
  DEFAULT_GOAL_FILTER,
  calculateGoalProgress,
  calculateGoalTaskProgress,
  calculateMilestoneProgress,
  filterGoals,
  getGoalHealth,
  isGoalActive,
  isGoalArchived,
  isGoalCompleted,
  isMilestoneOverdue,
  matchesGoalSearch,
  milestonesOf,
  progressOf,
  sortGoals,
  type GoalSummary,
} from './goalStats'

/**
 * The goal rules, with no database, no clock and no DOM.
 *
 * The load-bearing cases are the ones about what must *not* count: deleted
 * milestones, deleted tasks, and the task figure quietly overtaking the
 * milestone figure.
 */

const TODAY = '2026-09-03'
let seq = 0

function goal(overrides: Partial<Goal> = {}): Goal {
  seq += 1
  return {
    id: `goal-${seq}`,
    createdAt: seq,
    updatedAt: seq,
    deletedAt: null,
    title: 'Become strong in DSA',
    why: null,
    horizon: 'long',
    status: 'active',
    targetDate: null,
    sortOrder: seq * 1000,
    vaultPath: null,
    ...overrides,
  }
}

function milestone(goalId: string, overrides: Partial<Milestone> = {}): Milestone {
  seq += 1
  return {
    id: `milestone-${seq}`,
    createdAt: seq,
    updatedAt: seq,
    deletedAt: null,
    goalId,
    title: 'Trees',
    targetDate: null,
    done: false,
    sortOrder: seq * 1000,
    ...overrides,
  }
}

function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    ...taskInput(),
    id: `task-${seq}`,
    createdAt: seq,
    updatedAt: seq,
    deletedAt: null,
    ...overrides,
  } as Task
}

describe('statuses', () => {
  it('maps the model four ways without inventing a field', () => {
    expect(isGoalActive(goal({ status: 'active' }))).toBe(true)
    // "Paused" is still something being pursued, so it stays in the active list.
    expect(isGoalActive(goal({ status: 'paused' }))).toBe(true)
    expect(isGoalCompleted(goal({ status: 'achieved' }))).toBe(true)
    // The model's word for "no longer pursuing" is `dropped`; the UI calls it
    // archived, and nothing new is stored.
    expect(isGoalArchived(goal({ status: 'dropped' }))).toBe(true)
  })

  it('never treats a deleted goal as active', () => {
    expect(isGoalActive(goal({ status: 'active', deletedAt: 5 }))).toBe(false)
  })
})

describe('progressOf', () => {
  it('is zero for nothing to measure, not NaN', () => {
    expect(progressOf(0, 0)).toEqual({ done: 0, total: 0, percent: 0 })
  })

  it('never reads 100 while anything is outstanding', () => {
    expect(progressOf(199, 200).percent).toBe(99)
  })

  it('never reads 0 once anything is finished', () => {
    expect(progressOf(1, 500).percent).toBe(1)
  })

  it('rounds ordinary values normally', () => {
    expect(progressOf(2, 4).percent).toBe(50)
    expect(progressOf(4, 4).percent).toBe(100)
  })
})

describe('goal progress — the canonical rule', () => {
  it('is zero with no milestones and no tasks', () => {
    const g = goal()
    expect(calculateGoalProgress(g, [], [])).toEqual({ done: 0, total: 0, percent: 0 })
  })

  it('uses milestones when they exist', () => {
    const g = goal()
    const rows = [
      milestone(g.id, { done: true }),
      milestone(g.id, { done: true }),
      milestone(g.id),
      milestone(g.id),
    ]
    expect(calculateGoalProgress(g, rows, [])).toMatchObject({ done: 2, total: 4, percent: 50 })
  })

  it('reads 0 with one milestone open, and 100 with it done', () => {
    const g = goal()
    expect(calculateGoalProgress(g, [milestone(g.id)], []).percent).toBe(0)
    expect(calculateGoalProgress(g, [milestone(g.id, { done: true })], []).percent).toBe(100)
  })

  it('lets milestones win even when tasks disagree loudly', () => {
    // This is the whole reason milestones are primary: ninety finished chores
    // must not make an untouched checkpoint look nearly done.
    const g = goal()
    const rows = [milestone(g.id), milestone(g.id)]
    const tasks = Array.from({ length: 90 }, () => task({ status: 'done' }))

    expect(calculateGoalProgress(g, rows, tasks).percent).toBe(0)
    // …and the task figure is still available, just not as the headline.
    expect(calculateGoalTaskProgress(tasks).percent).toBe(100)
  })

  it('falls back to tasks when the goal has no milestones', () => {
    const g = goal()
    const tasks = [
      ...Array.from({ length: 7 }, () => task({ status: 'done' })),
      ...Array.from({ length: 3 }, () => task()),
    ]
    expect(calculateGoalProgress(g, [], tasks)).toMatchObject({ done: 7, total: 10, percent: 70 })
  })

  it('ignores a deleted milestone entirely', () => {
    const g = goal()
    const rows = [
      milestone(g.id, { done: true }),
      milestone(g.id, { deletedAt: 9 }),
      milestone(g.id, { done: true, deletedAt: 9 }),
    ]
    // One live milestone, done: 100 %, not 2 of 3.
    expect(calculateGoalProgress(g, rows, [])).toMatchObject({ done: 1, total: 1, percent: 100 })
  })

  it('falls through to tasks once every milestone is deleted', () => {
    const g = goal()
    const rows = [milestone(g.id, { deletedAt: 9 })]
    const tasks = [task({ status: 'done' }), task()]
    expect(calculateGoalProgress(g, rows, tasks).percent).toBe(50)
  })

  it('never counts milestones belonging to another goal', () => {
    const mine = goal()
    const theirs = goal()
    const rows = [milestone(mine.id, { done: true }), milestone(theirs.id)]
    expect(calculateGoalProgress(mine, rows, [])).toMatchObject({ total: 1, percent: 100 })
  })

  it('keeps reporting progress for a completed or reopened goal', () => {
    const g = goal({ status: 'achieved' })
    const rows = [milestone(g.id, { done: true }), milestone(g.id)]
    // Completion is a status, not a recount: the milestones still say 50 %.
    expect(calculateGoalProgress(g, rows, []).percent).toBe(50)
    expect(calculateGoalProgress({ ...g, status: 'active' }, rows, []).percent).toBe(50)
  })

  it('lists the live milestones of a goal in manual order', () => {
    const g = goal()
    const rows = [
      milestone(g.id, { title: 'B', sortOrder: 2000 }),
      milestone(g.id, { title: 'A', sortOrder: 1000 }),
      milestone(g.id, { title: 'gone', deletedAt: 1 }),
    ]
    expect(milestonesOf(g.id, rows).map((row) => row.title)).toEqual(['A', 'B'])
  })
})

describe('task progress', () => {
  it('excludes deleted tasks and recurrence templates', () => {
    const tasks = [
      task({ status: 'done' }),
      task({ status: 'done', deletedAt: 4 }),
      task({ isTemplate: true }),
      task(),
    ]
    expect(calculateGoalTaskProgress(tasks)).toMatchObject({ done: 1, total: 2, percent: 50 })
  })

  it('is zero with no tasks', () => {
    expect(calculateGoalTaskProgress([])).toEqual({ done: 0, total: 0, percent: 0 })
  })

  it('is 100 when everything is finished', () => {
    expect(calculateGoalTaskProgress([task({ status: 'done' })]).percent).toBe(100)
  })
})

describe('milestone progress', () => {
  it('counts only the tasks pointing at that milestone', () => {
    const tasks = [
      task({ milestoneId: 'm1', status: 'done' }),
      task({ milestoneId: 'm1', status: 'done' }),
      task({ milestoneId: 'm1' }),
      task({ milestoneId: 'm1' }),
      task({ milestoneId: 'm1' }),
      task({ milestoneId: 'm2', status: 'done' }),
      task({ milestoneId: null, status: 'done' }),
    ]
    expect(calculateMilestoneProgress('m1', tasks)).toMatchObject({
      done: 2,
      total: 5,
      percent: 40,
    })
  })

  it('is zero for a milestone nothing points at', () => {
    expect(calculateMilestoneProgress('m1', [])).toEqual({ done: 0, total: 0, percent: 0 })
  })

  it('ignores deleted tasks', () => {
    const tasks = [
      task({ milestoneId: 'm1', status: 'done' }),
      task({ milestoneId: 'm1', deletedAt: 3 }),
    ]
    expect(calculateMilestoneProgress('m1', tasks)).toMatchObject({ total: 1, percent: 100 })
  })
})

describe('goal health', () => {
  it('reports no deadline when there is none', () => {
    expect(getGoalHealth(goal(), TODAY)).toBe('no-deadline')
  })

  it('reports completed regardless of the date', () => {
    expect(getGoalHealth(goal({ status: 'achieved', targetDate: '2020-01-01' }), TODAY)).toBe(
      'completed',
    )
  })

  it('is on track for today and for the future', () => {
    expect(getGoalHealth(goal({ targetDate: TODAY }), TODAY)).toBe('on-track')
    expect(getGoalHealth(goal({ targetDate: '2026-09-04' }), TODAY)).toBe('on-track')
  })

  it('is overdue the day after the deadline passes', () => {
    expect(getGoalHealth(goal({ targetDate: '2026-09-02' }), TODAY)).toBe('overdue')
  })

  it('handles month, year and leap boundaries', () => {
    expect(getGoalHealth(goal({ targetDate: '2026-08-31' }), '2026-09-01')).toBe('overdue')
    expect(getGoalHealth(goal({ targetDate: '2026-12-31' }), '2027-01-01')).toBe('overdue')
    expect(getGoalHealth(goal({ targetDate: '2028-02-29' }), '2028-02-29')).toBe('on-track')
    expect(getGoalHealth(goal({ targetDate: '2028-02-29' }), '2028-03-01')).toBe('overdue')
  })

  it('still calls a paused goal overdue — pausing is not an extension', () => {
    expect(getGoalHealth(goal({ status: 'paused', targetDate: '2026-09-01' }), TODAY)).toBe(
      'overdue',
    )
  })

  it('marks an open milestone past its own date as overdue', () => {
    const g = goal()
    expect(isMilestoneOverdue(milestone(g.id, { targetDate: '2026-09-02' }), TODAY)).toBe(true)
    expect(isMilestoneOverdue(milestone(g.id, { targetDate: TODAY }), TODAY)).toBe(false)
    // A finished milestone is never late, however long it took.
    expect(
      isMilestoneOverdue(milestone(g.id, { targetDate: '2020-01-01', done: true }), TODAY),
    ).toBe(false)
    expect(isMilestoneOverdue(milestone(g.id), TODAY)).toBe(false)
  })
})

describe('sorting and filtering', () => {
  const summary = (overrides: Partial<Goal>, percent = 0): GoalSummary => {
    const g = goal(overrides)
    return {
      goal: g,
      progress: { done: 0, total: 0, percent },
      milestones: { done: 0, total: 0, percent: 0 },
      tasks: { done: 0, total: 0, percent: 0 },
      health: getGoalHealth(g, TODAY),
      overdueMilestones: 0,
    }
  }

  const titles = (rows: GoalSummary[]) => rows.map((row) => row.goal.title)

  it('sorts by manual order by default', () => {
    const rows = [
      summary({ title: 'B', sortOrder: 2000 }),
      summary({ title: 'A', sortOrder: 1000 }),
    ]
    expect(titles(sortGoals(rows, 'manual'))).toEqual(['A', 'B'])
  })

  it('sorts undated goals last when sorting by deadline', () => {
    const rows = [
      summary({ title: 'none', targetDate: null }),
      summary({ title: 'later', targetDate: '2026-12-01' }),
      summary({ title: 'sooner', targetDate: '2026-09-10' }),
    ]
    expect(titles(sortGoals(rows, 'deadline'))).toEqual(['sooner', 'later', 'none'])
  })

  it('sorts by progress, name and creation', () => {
    const rows = [
      summary({ title: 'B', createdAt: 1 }, 20),
      summary({ title: 'A', createdAt: 2 }, 80),
    ]
    expect(titles(sortGoals(rows, 'progress'))).toEqual(['A', 'B'])
    expect(titles(sortGoals(rows, 'name'))).toEqual(['A', 'B'])
    expect(titles(sortGoals(rows, 'created'))).toEqual(['A', 'B'])
  })

  it('is a total order — the answer cannot depend on row order', () => {
    const rows = [
      summary({ title: 'x', sortOrder: 1000, createdAt: 1 }),
      summary({ title: 'y', sortOrder: 1000, createdAt: 1 }),
    ]
    const forward = titles(sortGoals(rows, 'manual'))
    expect(titles(sortGoals([...rows].reverse(), 'manual'))).toEqual(forward)
  })

  it('sorts a copy, leaving a shared array alone', () => {
    const rows = [
      summary({ title: 'B', sortOrder: 2000 }),
      summary({ title: 'A', sortOrder: 1000 }),
    ]
    const before = titles(rows)
    sortGoals(rows, 'name')
    expect(titles(rows)).toEqual(before)
  })

  it('filters by state', () => {
    const rows = [
      summary({ title: 'active' }),
      summary({ title: 'paused', status: 'paused' }),
      summary({ title: 'done', status: 'achieved' }),
      summary({ title: 'dropped', status: 'dropped' }),
    ]
    expect(titles(filterGoals(rows, DEFAULT_GOAL_FILTER))).toEqual(['active', 'paused'])
    expect(titles(filterGoals(rows, { ...DEFAULT_GOAL_FILTER, state: 'completed' }))).toEqual([
      'done',
    ])
    expect(titles(filterGoals(rows, { ...DEFAULT_GOAL_FILTER, state: 'archived' }))).toEqual([
      'dropped',
    ])
    expect(filterGoals(rows, { ...DEFAULT_GOAL_FILTER, state: 'all' })).toHaveLength(4)
  })

  it('filters by health', () => {
    const rows = [
      summary({ title: 'late', targetDate: '2026-09-01' }),
      summary({ title: 'fine', targetDate: '2026-12-01' }),
    ]
    expect(titles(filterGoals(rows, { ...DEFAULT_GOAL_FILTER, health: 'overdue' }))).toEqual([
      'late',
    ])
    expect(titles(filterGoals(rows, { ...DEFAULT_GOAL_FILTER, health: 'on-track' }))).toEqual([
      'fine',
    ])
  })

  it('searches the title and the why', () => {
    const g = goal({ title: 'Become strong in DSA', why: 'Placement season starts soon' })
    expect(matchesGoalSearch(g, 'dsa')).toBe(true)
    expect(matchesGoalSearch(g, 'placement')).toBe(true)
    expect(matchesGoalSearch(g, 'strong placement')).toBe(true)
    expect(matchesGoalSearch(g, 'strong swimming')).toBe(false)
    expect(matchesGoalSearch(g, '   ')).toBe(true)
  })
})
