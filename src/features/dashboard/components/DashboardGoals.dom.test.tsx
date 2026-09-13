import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { projectRepo, taskRepo } from '@/repositories'
import {
  completeMilestone,
  createGoal,
  createMilestone,
  getDashboard,
  getGoalsView,
} from '@/services'
import { projectInput, taskInput } from '../../../../tests/factories'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { DashboardGoals } from './DashboardGoals'

/**
 * The Dashboard's goals card.
 *
 * The property under test is agreement: the card and the Goals page must report
 * the same percentage for the same goal, because both read the same service. If
 * a second implementation of goal arithmetic ever appears, these fail.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const mount = async () => {
  const data = await getDashboard()
  render(
    <MemoryRouter>
      <DashboardGoals summary={data.goals} />
    </MemoryRouter>,
  )
  return data
}

describe('the card', () => {
  it('reports the same progress the Goals page reports', async () => {
    const goal = await createGoal('Become strong in DSA', { targetDate: '2026-12-01' })
    const first = await createMilestone(goal.id, 'Arrays')
    await createMilestone(goal.id, 'Trees')
    await createMilestone(goal.id, 'Graphs')
    await createMilestone(goal.id, 'DP')
    await completeMilestone(first.id)

    const page = (await getGoalsView()).goals[0]
    await mount()

    const bar = await screen.findByRole('progressbar', {
      name: 'Become strong in DSA progress',
    })
    expect(bar.getAttribute('aria-valuenow')).toBe(String(page?.progress.percent))
    expect(bar.getAttribute('aria-valuenow')).toBe('25')
  })

  it('states health in words, not only colour', async () => {
    await createGoal('late', { targetDate: '2026-09-01' })
    await mount()

    expect(await screen.findByText('Overdue')).toBeTruthy()
  })

  it('counts active goals and flags how many are overdue', async () => {
    await createGoal('late', { targetDate: '2026-09-01' })
    await createGoal('fine', { targetDate: '2026-12-01' })

    await mount()
    expect(await screen.findByLabelText('2 active goals')).toBeTruthy()
    expect(screen.getByText('1 overdue')).toBeTruthy()
  })

  it('shows nothing alarming when there are no goals', async () => {
    await mount()
    expect(await screen.findByText(/No active goals/)).toBeTruthy()
  })

  it('links each goal to its own panel', async () => {
    const goal = await createGoal('DSA')
    await mount()

    const link = await screen.findByRole('link', { name: 'DSA' })
    expect(link.getAttribute('href')).toBe(`/goals?goal=${goal.id}`)
  })

  it('leaves the Next Action to tasks — no goal appears in it', async () => {
    const goal = await createGoal('Become strong in DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    await taskRepo.create(
      taskInput({ title: 'Solve two array problems', milestoneId: milestone.id }),
    )

    const data = await getDashboard()
    // A goal is not an answer to "what should I do in the next ten minutes".
    expect(data.nextAction?.title).toBe('Solve two array problems')
  })

  it('uses the task figure when a goal has no checkpoints', async () => {
    const goal = await createGoal('Ship it')
    const project = await projectRepo.create(projectInput({ goalId: goal.id }))
    await taskRepo.create(taskInput({ projectId: project.id, status: 'done' }))
    await taskRepo.create(taskInput({ projectId: project.id }))

    const data = await mount()
    expect(data.goals.goals[0]?.basis).toBe('tasks')
    const bar = await screen.findByRole('progressbar', { name: 'Ship it progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
  })
})
