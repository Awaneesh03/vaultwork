import { beforeEach, describe, expect, it } from 'vitest'
import { focusSessionRepo } from '@/repositories'
import { attachLink, captureText, createNote, getTodayContext } from '@/services'
import { createGoal } from '@/services/goalService'
import { completeHabit, createHabit } from '@/services/habitService'
import { createProject } from '@/services/projectService'
import { completeTask, createTask } from '@/services/taskService'
import { freezeClock, resetDatabase } from './helpers'
import { taskInput } from './factories'

/**
 * M19 end to end: the Today context, built from real rows in IndexedDB.
 *
 * Monday 21 September 2026, 10:00 local. Everything here is Vaultwork's own
 * data; nothing is fetched and nothing is modelled.
 */

const NOW = new Date(2026, 8, 21, 10, 0, 0)
const TODAY = '2026-09-21'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const add = (overrides: Parameters<typeof taskInput>[0]) => createTask(taskInput(overrides))

describe('an empty day', () => {
  it('has no next action, nothing planned, and fabricates nothing', async () => {
    const day = await getTodayContext()
    expect(day.nextAction).toBeNull()
    expect(day.planned).toEqual([])
    expect(day.reasons.size).toBe(0)
    expect(day.dayProgress).toEqual({
      tasksDone: 0,
      tasksPlanned: 0,
      focusMinutes: 0,
      habitsDone: 0,
      habitsScheduled: 0,
    })
    expect(day.timeBudget).toMatchObject({
      plannedTasks: 0,
      estimatedMinutes: 0,
      availableMinutes: null,
      fit: 'unknown',
    })
    expect(day.knowledge).toEqual([])
    expect(day.capturesWaiting).toBe(0)
  })
})

describe('what matters, and why', () => {
  it('explains overdue, due-today, scheduled and upcoming work in words', async () => {
    const late = await add({ title: 'Late report', dueDate: '2026-09-18' })
    const today = await add({ title: 'Study DBMS', dueDate: TODAY })
    const timed = await add({ title: 'Standup', dueDate: TODAY, dueTime: '15:00' })
    const soon = await add({ title: 'Maths project', dueDate: '2026-09-24' })

    const day = await getTodayContext()
    expect(day.reasons.get(late.id)).toBe('Overdue by 3 days')
    expect(day.lateness.get(late.id)).toBe(3)
    expect(day.reasons.get(today.id)).toBe('Due today')
    expect(day.reasons.get(timed.id)).toBe('Scheduled 3 pm')
    expect(day.reasons.get(soon.id)).toBe('Due in 3 days')
    // Only late work has a lateness.
    expect(day.lateness.has(today.id)).toBe(false)
  })

  it('names the project in the reason when the task has one', async () => {
    const project = await createProject('Vaultwork')
    const task = await add({ title: 'M19', dueDate: TODAY, projectId: project.id })
    expect((await getTodayContext()).reasons.get(task.id)).toBe('Due today · Vaultwork')
  })
})

describe('the next action — the existing rule, explained', () => {
  it('puts overdue before due today', async () => {
    await add({ title: 'Today', dueDate: TODAY, priority: 'urgent' })
    const late = await add({ title: 'Late', dueDate: '2026-09-20' })
    const day = await getTodayContext()
    expect(day.nextAction?.id).toBe(late.id)
    expect(day.reasons.get(late.id)).toBe('Overdue by 1 day')
  })

  it('puts due today before upcoming', async () => {
    await add({ title: 'Later', dueDate: '2026-09-22', priority: 'urgent' })
    const today = await add({ title: 'Today', dueDate: TODAY })
    expect((await getTodayContext()).nextAction?.id).toBe(today.id)
  })

  it('respects existing priority within the same day', async () => {
    await add({ title: 'Low', dueDate: TODAY, priority: 'low' })
    const high = await add({ title: 'High', dueDate: TODAY, priority: 'high' })
    const day = await getTodayContext()
    expect(day.nextAction?.id).toBe(high.id)
    expect(day.reasons.get(high.id)).toBe('Due today · High priority')
  })

  it('picks the earlier scheduled task when all else is equal', async () => {
    await add({ title: 'Afternoon', dueDate: TODAY, dueTime: '16:00' })
    const morning = await add({ title: 'Morning', dueDate: TODAY, dueTime: '09:00' })
    expect((await getTodayContext()).nextAction?.id).toBe(morning.id)
  })

  it('orders the whole plate by the same rule, deterministically', async () => {
    const a = await add({ title: 'A', dueDate: TODAY })
    const b = await add({ title: 'B', dueDate: '2026-09-19' })
    const c = await add({ title: 'C', dueDate: TODAY, priority: 'high' })
    await add({ title: 'Future', dueDate: '2026-09-30' })
    await add({ title: 'Undated' })

    const first = (await getTodayContext()).planned.map((task) => task.id)
    const second = (await getTodayContext()).planned.map((task) => task.id)
    expect(first).toEqual([b.id, c.id, a.id])
    expect(second).toEqual(first)
  })
})

describe('progress and the time budget', () => {
  it('counts tasks done against today’s load, excluding overdue work', async () => {
    const done = await add({ title: 'Done today', dueDate: TODAY })
    await completeTask(done.id)
    await add({ title: 'Still due', dueDate: TODAY })
    await add({ title: 'Late', dueDate: '2026-09-15' })

    expect((await getTodayContext()).dayProgress).toMatchObject({ tasksDone: 1, tasksPlanned: 2 })
  })

  it('sums only real estimates, and never claims to know available time', async () => {
    await add({ title: 'Estimated', dueDate: TODAY, estimateMin: 45 })
    await add({ title: 'Also estimated', dueDate: '2026-09-20', estimateMin: 90 })
    await add({ title: 'No estimate', dueDate: TODAY })
    await add({ title: 'Future, not today', dueDate: '2026-09-25', estimateMin: 600 })

    expect((await getTodayContext()).timeBudget).toEqual({
      plannedTasks: 3,
      estimatedTasks: 2,
      unestimatedTasks: 1,
      estimatedMinutes: 135,
      availableMinutes: null,
      fit: 'unknown',
    })
  })

  it('reads focus minutes by the Analytics definition — actual minutes, ended today', async () => {
    const start = NOW.getTime() - 60 * 60_000
    await focusSessionRepo.create({
      taskId: null,
      projectId: null,
      kind: 'work',
      startedAt: start,
      endedAt: start + 25 * 60_000,
      plannedMin: 25,
      actualMin: 25,
      outcome: 'completed',
    })
    expect((await getTodayContext()).dayProgress.focusMinutes).toBe(25)
  })

  it('reports today’s habits as the Habits screen counts them', async () => {
    const habit = await createHabit('Hydration')
    await createHabit('DSA')
    await completeHabit(habit.id)
    expect((await getTodayContext()).dayProgress).toMatchObject({
      habitsDone: 1,
      habitsScheduled: 2,
    })
  })
})

describe('context the day carries', () => {
  it('includes active projects and goals from their own services', async () => {
    await createProject('FixKaru')
    await createGoal('DSA preparation')
    const day = await getTodayContext()
    expect(day.projects.map((entry) => entry.project.name)).toContain('FixKaru')
    expect(day.goals.activeCount).toBe(1)
  })

  it('shows recent changes from the event log', async () => {
    const task = await add({ title: 'Ship M19', dueDate: TODAY })
    await completeTask(task.id)
    const labels = (await getTodayContext()).activity.map((entry) => entry.label)
    expect(labels.some((label) => label.includes('Ship M19'))).toBe(true)
  })

  it('counts Universal Inbox captures still waiting', async () => {
    await captureText('Buy a laptop stand')
    await captureText('Research RAG')
    expect((await getTodayContext()).capturesWaiting).toBe(2)
  })
})

describe('related knowledge', () => {
  it('appears only when a note is linked to the next action or its project', async () => {
    const project = await createProject('Vaultwork')
    const task = await add({ title: 'MCP docs', dueDate: TODAY, projectId: project.id })
    await createNote({ title: 'Unrelated thought', body: 'nothing to do with it' })

    const before = await getTodayContext()
    expect(before.knowledge).toEqual([])
    expect(before.sources.knowledge).toBe('none')

    const note = await createNote({ title: 'MCP Architecture', body: 'how it fits' })
    await attachLink(note.id, 'project', project.id)
    const onTask = await createNote({ title: 'Docs outline', body: '' })
    await attachLink(onTask.id, 'task', task.id)

    const after = await getTodayContext()
    // The task's own note first, then its project's; never the unrelated one.
    expect(after.knowledge.map((entry) => entry.title)).toEqual([
      'Docs outline',
      'MCP Architecture',
    ])
    expect(after.sources.knowledge).toBe('included')
  })
})

describe('sources', () => {
  it('states that unconnected sources are unconnected, and contributes nothing from them', async () => {
    await add({ title: 'Something', dueDate: TODAY })
    const { sources } = await getTodayContext()
    expect(sources).toEqual({
      vaultwork: 'included',
      knowledge: 'none',
      calendar: 'notConnected',
      email: 'notConnected',
      external: 'notConnected',
    })
  })
})
