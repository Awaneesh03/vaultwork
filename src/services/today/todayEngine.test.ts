import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/entities'
import { daysLate, fitOf, progressFor, reasonFor, timeBudgetFor } from './todayEngine'

/**
 * The Today Engine's pure rules. Monday 21 September 2026; every date below is
 * relative to it, and nothing reads a clock.
 */

const TODAY = '2026-09-21'

const task = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    title: 'A task',
    description: null,
    status: 'todo',
    priority: 'none',
    dueDate: null,
    dueTime: null,
    startDate: null,
    estimateMin: null,
    projectId: null,
    milestoneId: null,
    tagIds: [],
    recurrence: null,
    seriesId: null,
    isTemplate: false,
    sortOrder: 1000,
    completedAt: null,
    reminderAt: null,
    vaultPath: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  }) as Task

describe('reasons', () => {
  it('says how late an overdue task is, in days', () => {
    expect(reasonFor(task({ dueDate: '2026-09-20' }), TODAY)).toBe('Overdue by 1 day')
    expect(reasonFor(task({ dueDate: '2026-09-16' }), TODAY)).toBe('Overdue by 5 days')
  })

  it('distinguishes due today from scheduled today', () => {
    expect(reasonFor(task({ dueDate: TODAY }), TODAY)).toBe('Due today')
    expect(reasonFor(task({ dueDate: TODAY, dueTime: '15:00' }), TODAY)).toBe('Scheduled 3 pm')
  })

  it('names the approaching days plainly', () => {
    expect(reasonFor(task({ dueDate: '2026-09-22' }), TODAY)).toBe('Due tomorrow')
    expect(reasonFor(task({ dueDate: '2026-09-24' }), TODAY)).toBe('Due in 3 days')
    expect(reasonFor(task(), TODAY)).toBe('No due date')
  })

  it('adds only the signals that are present, in the rule’s own order', () => {
    expect(reasonFor(task({ dueDate: TODAY, priority: 'high' }), TODAY, 'Vaultwork')).toBe(
      'Due today · High priority · Vaultwork',
    )
    expect(reasonFor(task({ dueDate: TODAY, priority: 'urgent' }), TODAY)).toBe(
      'Due today · Urgent priority',
    )
    // Low and medium are not reasons to look today; they are not mentioned.
    expect(reasonFor(task({ dueDate: TODAY, priority: 'low' }), TODAY)).toBe('Due today')
  })

  it('does not call a completed task late', () => {
    expect(daysLate(task({ dueDate: '2026-09-10', status: 'done' }), TODAY)).toBeNull()
    expect(daysLate(task({ dueDate: TODAY }), TODAY)).toBeNull()
    expect(daysLate(task({ dueDate: '2026-09-18' }), TODAY)).toBe(3)
  })

  it('is deterministic — the same task, the same words', () => {
    const t = task({ dueDate: '2026-09-18', priority: 'high' })
    expect(reasonFor(t, TODAY, 'X')).toBe(reasonFor(t, TODAY, 'X'))
  })
})

describe('progress', () => {
  it('counts today’s load as done-today plus still-due-today, never overdue work', () => {
    expect(
      progressFor({
        completedToday: 4,
        openDueToday: 3,
        focusMinutes: 82,
        habitsDone: 3,
        habitsScheduled: 5,
      }),
    ).toEqual({
      tasksDone: 4,
      tasksPlanned: 7,
      focusMinutes: 82,
      habitsDone: 3,
      habitsScheduled: 5,
    })
  })
})

describe('time budget', () => {
  const planned = [
    task({ id: 'a', dueDate: TODAY, estimateMin: 45 }),
    task({ id: 'b', dueDate: TODAY, estimateMin: 90 }),
    task({ id: 'c', dueDate: '2026-09-19', estimateMin: null }),
    task({ id: 'd', dueDate: TODAY, estimateMin: 0 }),
  ]

  it('adds only the estimates that exist and counts the rest as unestimated', () => {
    expect(timeBudgetFor(planned)).toEqual({
      plannedTasks: 4,
      estimatedTasks: 2,
      unestimatedTasks: 2,
      estimatedMinutes: 135,
      availableMinutes: null,
      fit: 'unknown',
    })
  })

  it('never invents a duration: an all-unestimated day totals nothing', () => {
    const budget = timeBudgetFor([task({ dueDate: TODAY }), task({ id: 'x', dueDate: TODAY })])
    expect(budget.estimatedMinutes).toBe(0)
    expect(budget.estimatedTasks).toBe(0)
    expect(budget.unestimatedTasks).toBe(2)
  })

  it('ignores completed work', () => {
    const budget = timeBudgetFor([task({ status: 'done', estimateMin: 60 })])
    expect(budget.plannedTasks).toBe(0)
    expect(budget.estimatedMinutes).toBe(0)
  })

  it('says unknown whenever available time is unknown — which it is today', () => {
    expect(fitOf(135, null)).toBe('unknown')
    expect(timeBudgetFor(planned).fit).toBe('unknown')
  })

  it('reports over-commitment and spare capacity once real availability exists', () => {
    // The comparison a future working-hours or calendar source will feed.
    expect(fitOf(135, 360)).toBe('fits')
    expect(fitOf(360, 360)).toBe('fits')
    expect(fitOf(500, 360)).toBe('over')
    expect(timeBudgetFor(planned, 60).fit).toBe('over')
    expect(timeBudgetFor(planned, 240).fit).toBe('fits')
  })
})
