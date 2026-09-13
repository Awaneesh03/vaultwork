import { beforeEach, describe, expect, it } from 'vitest'
import { projectRepo, taskRepo } from '@/repositories'
import { projectInput, taskInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import {
  archiveGoal,
  completeGoal,
  completeMilestone,
  createGoal,
  createMilestone,
  deleteMilestone,
} from './goalService'
import {
  DASHBOARD_GOAL_LIMIT,
  getGoalDashboard,
  getGoalDetail,
  getGoalsView,
  getMilestoneTasks,
} from './goalQueryService'
import { completeTask } from './taskService'

/**
 * The view models the goal screens render.
 *
 * The point of these tests is that the Goals page and the Dashboard are reading
 * the *same* computation: if the two could ever report different progress for
 * one goal, it would show up here first.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const titles = (rows: { goal: { title: string } }[]) => rows.map((row) => row.goal.title)

describe('goals view', () => {
  it('reports an empty world distinctly from an empty filter result', async () => {
    const empty = await getGoalsView()
    expect(empty.empty).toBe(true)
    expect(empty.goals).toEqual([])

    await createGoal('DSA')
    const filtered = await getGoalsView({ filter: { search: 'nothing matches' } })
    // There *are* goals; none match. The view must not claim to be empty.
    expect(filtered.empty).toBe(false)
    expect(filtered.goals).toEqual([])
  })

  it('shows active goals by default and counts every state', async () => {
    await createGoal('active one')
    const done = await createGoal('finished')
    const dropped = await createGoal('abandoned')
    await completeGoal(done.id)
    await archiveGoal(dropped.id)

    const view = await getGoalsView()
    expect(titles(view.goals)).toEqual(['active one'])
    // The totals describe every live goal, not just the visible ones.
    expect(view.totals).toMatchObject({ all: 3, active: 1, completed: 1, archived: 1 })
  })

  it('builds milestone progress as the headline figure', async () => {
    const goal = await createGoal('DSA')
    const first = await createMilestone(goal.id, 'Arrays')
    await createMilestone(goal.id, 'Trees')
    await completeMilestone(first.id)

    const [item] = (await getGoalsView()).goals
    expect(item?.progress).toMatchObject({ done: 1, total: 2, percent: 50 })
    expect(item?.milestoneViews.map((view) => view.milestone.title)).toEqual([
      'Arrays',
      'Trees',
    ])
  })

  it('falls back to task progress when a goal has no milestones', async () => {
    const goal = await createGoal('Ship it')
    const project = await projectRepo.create(projectInput({ goalId: goal.id }))
    const done = await taskRepo.create(taskInput({ projectId: project.id }))
    await taskRepo.create(taskInput({ projectId: project.id }))
    await completeTask(done.id)

    const [item] = (await getGoalsView()).goals
    expect(item?.progress).toMatchObject({ done: 1, total: 2, percent: 50 })
    expect(item?.milestones.total).toBe(0)
  })

  it('ignores tasks in an archived project', async () => {
    const goal = await createGoal('Ship it')
    const live = await projectRepo.create(projectInput({ name: 'live', goalId: goal.id }))
    const shelved = await projectRepo.create(
      projectInput({ name: 'shelved', goalId: goal.id, status: 'archived' }),
    )
    await taskRepo.create(taskInput({ projectId: live.id }))
    await taskRepo.create(taskInput({ projectId: shelved.id }))

    const [item] = (await getGoalsView()).goals
    // One project's worth of work, not two — an abandoned project cannot hold
    // the goal down for ever.
    expect(item?.tasks.total).toBe(1)
    expect(item?.projects.map((project) => project.name)).toEqual(['live'])
  })

  it('counts a task reachable both ways only once', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const project = await projectRepo.create(projectInput({ goalId: goal.id }))
    await taskRepo.create(taskInput({ milestoneId: milestone.id, projectId: project.id }))

    const [item] = (await getGoalsView()).goals
    expect(item?.tasks.total).toBe(1)
  })

  it('drops a soft-deleted milestone out of the headline figure', async () => {
    const goal = await createGoal('DSA')
    const done = await createMilestone(goal.id, 'Arrays')
    const open = await createMilestone(goal.id, 'Trees')
    await completeMilestone(done.id)

    expect((await getGoalsView()).goals[0]?.progress.percent).toBe(50)

    await deleteMilestone(open.id)
    // One live milestone, and it is done.
    const [item] = (await getGoalsView()).goals
    expect(item?.progress).toMatchObject({ done: 1, total: 1, percent: 100 })
    expect(item?.milestoneViews).toHaveLength(1)
  })

  it('derives health from the goal deadline', async () => {
    await createGoal('late', { targetDate: '2026-09-01' })
    await createGoal('fine', { targetDate: '2026-12-01' })
    await createGoal('undated')

    const view = await getGoalsView({ sort: 'name' })
    expect(view.goals.map((item) => [item.goal.title, item.health])).toEqual([
      ['fine', 'on-track'],
      ['late', 'overdue'],
      ['undated', 'no-deadline'],
    ])
    expect(view.totals.overdue).toBe(1)
  })

  it('flags an overdue milestone without touching goal health', async () => {
    const goal = await createGoal('DSA', { targetDate: '2027-01-01' })
    await createMilestone(goal.id, 'Arrays', { targetDate: '2026-09-01' })
    await createMilestone(goal.id, 'Trees', { targetDate: '2027-01-01' })

    const [item] = (await getGoalsView()).goals
    // The goal is fine; one of its checkpoints is not. Two separate facts.
    expect(item?.health).toBe('on-track')
    expect(item?.overdueMilestones).toBe(1)
  })

  it('filters by state, health and search', async () => {
    const late = await createGoal('Learn Rust', { targetDate: '2026-09-01' })
    await createGoal('Read more books', { why: 'fiction mostly' })
    const done = await createGoal('Run a marathon')
    await completeGoal(done.id)

    expect(titles((await getGoalsView({ filter: { health: 'overdue' } })).goals)).toEqual([
      'Learn Rust',
    ])
    expect(titles((await getGoalsView({ filter: { search: 'fiction' } })).goals)).toEqual([
      'Read more books',
    ])
    expect(titles((await getGoalsView({ filter: { state: 'completed' } })).goals)).toEqual([
      'Run a marathon',
    ])
    expect((await getGoalsView({ filter: { state: 'all' } })).goals).toHaveLength(3)
    expect(late.status).toBe('active')
  })

  it('sorts by deadline with undated goals last', async () => {
    await createGoal('undated')
    await createGoal('december', { targetDate: '2026-12-01' })
    await createGoal('october', { targetDate: '2026-10-01' })

    const view = await getGoalsView({ sort: 'deadline' })
    expect(titles(view.goals)).toEqual(['october', 'december', 'undated'])
  })

  it('reports today from the clock port', async () => {
    expect((await getGoalsView()).today).toBe(TODAY)
  })
})

describe('goal detail', () => {
  it('returns undefined for a goal that is not there', async () => {
    expect(await getGoalDetail('missing')).toBeUndefined()
  })

  it('separates work under a checkpoint from work merely under the goal', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const project = await projectRepo.create(projectInput({ goalId: goal.id }))

    await taskRepo.create(taskInput({ title: 'checkpointed', milestoneId: milestone.id }))
    await taskRepo.create(taskInput({ title: 'loose', projectId: project.id }))

    const detail = await getGoalDetail(goal.id)
    expect(detail?.relatedTasks).toHaveLength(2)
    expect(detail?.unassignedTasks.map((task) => task.title)).toEqual(['loose'])
  })

  it('reports a milestone task counts beside its done flag, not instead of it', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const done = await taskRepo.create(taskInput({ milestoneId: milestone.id }))
    await taskRepo.create(taskInput({ milestoneId: milestone.id }))
    await completeTask(done.id)

    await completeMilestone(milestone.id)

    const detail = await getGoalDetail(goal.id)
    const view = detail?.milestoneViews[0]
    // The checkpoint is met even though a task under it is still open.
    expect(view?.milestone.done).toBe(true)
    expect(view?.tasks).toMatchObject({ done: 1, total: 2 })
    expect(detail?.progress.percent).toBe(100)
  })

  it('lists the live tasks under one milestone', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const kept = await taskRepo.create(taskInput({ title: 'kept', milestoneId: milestone.id }))
    const gone = await taskRepo.create(taskInput({ title: 'gone', milestoneId: milestone.id }))
    await taskRepo.softDelete(gone.id)

    expect((await getMilestoneTasks(milestone.id)).map((task) => task.id)).toEqual([kept.id])
  })
})

describe('dashboard summary', () => {
  it('reports the same progress the goals page reports', async () => {
    const goal = await createGoal('DSA', { targetDate: '2026-12-01' })
    const first = await createMilestone(goal.id, 'Arrays')
    await createMilestone(goal.id, 'Trees')
    await createMilestone(goal.id, 'Graphs')
    await completeMilestone(first.id)

    const page = (await getGoalsView()).goals[0]
    const card = (await getGoalDashboard()).goals[0]

    expect(card?.progress).toEqual(page?.progress)
    expect(card?.health).toEqual(page?.health)
    expect(card?.title).toBe('DSA')
    expect(card?.basis).toBe('milestones')
  })

  it('says when a percentage came from tasks rather than checkpoints', async () => {
    const goal = await createGoal('Ship it')
    const project = await projectRepo.create(projectInput({ goalId: goal.id }))
    await taskRepo.create(taskInput({ projectId: project.id }))

    expect((await getGoalDashboard()).goals[0]?.basis).toBe('tasks')

    await createGoal('Nothing attached')
    const card = (await getGoalDashboard()).goals.find((row) => row.title === 'Nothing attached')
    expect(card?.basis).toBe('none')
  })

  it('shows active goals only, deadline first, capped', async () => {
    const done = await createGoal('finished')
    await completeGoal(done.id)
    await createGoal('undated')
    for (const day of ['2026-12-01', '2026-11-01', '2026-10-01', '2026-09-20']) {
      await createGoal(`due ${day}`, { targetDate: day })
    }

    const summary = await getGoalDashboard()
    expect(summary.goals).toHaveLength(DASHBOARD_GOAL_LIMIT)
    expect(summary.goals.map((row) => row.title)).toEqual([
      'due 2026-09-20',
      'due 2026-10-01',
      'due 2026-11-01',
      'due 2026-12-01',
    ])
    expect(summary.goals.some((row) => row.title === 'finished')).toBe(false)
    expect(summary.activeCount).toBe(5)
    expect(summary.completedCount).toBe(1)
  })

  it('counts overdue active goals', async () => {
    await createGoal('late', { targetDate: '2026-09-01' })
    await createGoal('fine', { targetDate: '2026-12-01' })
    expect((await getGoalDashboard()).overdueCount).toBe(1)
  })

  it('is empty and harmless with no goals at all', async () => {
    const summary = await getGoalDashboard()
    expect(summary.goals).toEqual([])
    expect(summary.activeCount).toBe(0)
    expect(summary.overdueCount).toBe(0)
    expect(summary.today).toBe(TODAY)
  })
})
