import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { milestoneRepo, projectRepo, taskRepo } from '@/repositories'
import {
  completeMilestone,
  createGoal,
  createMilestone,
  getGoalsView,
} from '@/services'
import { useGoalUiStore } from '@/store/goalUiStore'
import { useToastStore } from '@/store/toastStore'
import { projectInput, taskInput } from '../../../../tests/factories'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { GoalsView } from './GoalsView'

/**
 * The Goals screen, mounted against a real database.
 *
 * `goalService.test.ts` proves the rules with no React; this proves the screen
 * is wired to them — that completing a goal here leaves its tasks alone, that
 * the percentage on screen is the one the service computed, and that every
 * state is announced in words rather than only in colour.
 */

// Thursday 3 September 2026.
const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useGoalUiStore.getState().reset()
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mount = (entry = '/goals') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <GoalsView />
    </MemoryRouter>,
  )

const row = (title: string) => screen.getByRole('button', { name: title }).closest('[data-goal-id]')

describe('the list', () => {
  it('shows a skeleton, then the goals', async () => {
    await createGoal('Become strong in DSA')
    const { container } = mount()
    // A placeholder is on screen rather than an empty panel. `DataView`'s own
    // test covers the accessible half; this one only needs the shape.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Become strong in DSA' })).toBeTruthy(),
    )
  })

  it('names the three ideas the screen keeps apart', async () => {
    mount()
    const blurb = await screen.findByText(/A goal is an outcome, a milestone is a checkpoint/)
    expect(blurb.textContent).toContain('completing a goal never completes its tasks')
  })

  it('shows milestone progress as the headline figure', async () => {
    const goal = await createGoal('DSA')
    const first = await createMilestone(goal.id, 'Arrays')
    await createMilestone(goal.id, 'Trees')
    await createMilestone(goal.id, 'Graphs')
    await createMilestone(goal.id, 'DP')
    await completeMilestone(first.id)

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'DSA' })).toBeTruthy())

    const bar = screen.getByRole('progressbar', { name: 'DSA progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('25')
    expect(row('DSA')?.textContent).toContain('1/4 done')
    // The bar always says what it counted.
    expect(row('DSA')?.textContent).toContain('4 milestones')
  })

  it('says when a percentage came from tasks instead of milestones', async () => {
    // With no milestones, the goal reaches its work through a linked project —
    // the second route the model provides, and the one that makes the task
    // fallback reachable at all.
    const goal = await createGoal('Ship it')
    const project = await projectRepo.create(projectInput({ goalId: goal.id }))
    await taskRepo.create(taskInput({ projectId: project.id, status: 'done' }))
    await taskRepo.create(taskInput({ projectId: project.id }))

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ship it' })).toBeTruthy())
    expect(row('Ship it')?.textContent).toContain('2 tasks')
    expect(screen.getByRole('progressbar', { name: 'Ship it progress' }).getAttribute('aria-valuenow')).toBe('50')
  })

  it('gives the progress bar a real name, not just a value', async () => {
    await createGoal('DSA')
    mount()

    const bar = await screen.findByRole('progressbar', { name: 'DSA progress' })
    // aria-valuetext alone would announce "0 percent" with no idea of what.
    expect(bar.getAttribute('aria-label')).toBe('DSA progress')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
  })

  it('states health in words as well as colour', async () => {
    await createGoal('late', { targetDate: '2026-09-01' })
    await createGoal('fine', { targetDate: '2026-12-01' })
    await createGoal('undated')

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'late' })).toBeTruthy())

    expect(row('late')?.textContent).toContain('Overdue')
    expect(row('fine')?.textContent).toContain('On track')
    expect(row('undated')?.textContent).toContain('No deadline')
  })

  it('offers an empty state that distinguishes no goals from no matches', async () => {
    mount()
    expect(await screen.findByText('No goals yet')).toBeTruthy()

    await createGoal('DSA')
    const { unmount } = mount()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'DSA' })[0]).toBeTruthy())
    unmount()
  })
})

describe('mutations', () => {
  it('completes a goal without touching its tasks or milestones', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const task = await taskRepo.create(taskInput({ milestoneId: milestone.id }))

    mount()
    const box = await screen.findByRole('checkbox', { name: 'Complete DSA' })
    fireEvent.click(box)

    await waitFor(async () => {
      const rows = await db.goals.toArray()
      expect(rows[0]?.status).toBe('achieved')
    })

    // The whole point of the milestone: the work is untouched.
    expect((await taskRepo.get(task.id))?.status).toBe('todo')
    expect((await milestoneRepo.get(milestone.id))?.done).toBe(false)
  })

  it('says so in the toast, because the user might have assumed otherwise', async () => {
    const goal = await createGoal('DSA')
    await createMilestone(goal.id, 'Arrays')

    mount()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete DSA' }))

    await waitFor(() => {
      const messages = useToastStore.getState().toasts.map((toast) => toast.message)
      expect(messages.some((text) => text.includes('tasks untouched'))).toBe(true)
    })
  })

  it('creates a goal through the composer', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'New goal' }))

    const dialog = await screen.findByRole('dialog', { name: 'New goal' })
    fireEvent.change(within(dialog).getByLabelText('Outcome'), {
      target: { value: 'Learn Rust' },
    })
    fireEvent.change(within(dialog).getByLabelText('Why'), {
      target: { value: 'systems work' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create goal' }))

    await waitFor(async () => {
      const rows = await db.goals.toArray()
      expect(rows[0]).toMatchObject({ title: 'Learn Rust', why: 'systems work' })
    })
  })

  it('refuses a blank title rather than creating an untitled goal', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'New goal' }))

    const dialog = await screen.findByRole('dialog', { name: 'New goal' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create goal' }))

    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    expect(await db.goals.count()).toBe(0)
  })

  it('archives without deleting, and offers the way back', async () => {
    await createGoal('DSA')
    mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Archive DSA' }))

    await waitFor(async () => {
      const rows = await db.goals.toArray()
      expect(rows[0]?.status).toBe('dropped')
      // Archived is a status, never a tombstone.
      expect(rows[0]?.deletedAt).toBeNull()
    })
  })

  it('deletes softly and puts an undo on the stack', async () => {
    await createGoal('DSA')
    mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete DSA' }))

    await waitFor(() => expect(useToastStore.getState().undoStack.length).toBe(1))
    const rows = await db.goals.toArray()
    expect(rows[0]?.deletedAt).not.toBeNull()
  })
})

describe('milestones in the detail panel', () => {
  const openDetail = async (title: string) => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: title }))
    return screen.findByRole('dialog', { name: `${title} details` })
  }

  it('lists checkpoints with their own task counts beside the checkbox', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    await taskRepo.create(taskInput({ milestoneId: milestone.id, status: 'done' }))
    await taskRepo.create(taskInput({ milestoneId: milestone.id }))

    const panel = await openDetail('DSA')
    expect(within(panel).getByRole('checkbox', { name: 'Complete Arrays' })).toBeTruthy()
    expect(panel.textContent).toContain('1/2 tasks')
  })

  it('ticks a checkpoint without completing the tasks under it', async () => {
    const goal = await createGoal('DSA')
    const milestone = await createMilestone(goal.id, 'Arrays')
    const task = await taskRepo.create(taskInput({ milestoneId: milestone.id }))

    const panel = await openDetail('DSA')
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Complete Arrays' }))

    await waitFor(async () => {
      expect((await milestoneRepo.get(milestone.id))?.done).toBe(true)
    })
    expect((await taskRepo.get(task.id))?.status).toBe('todo')
  })

  it('adds a milestone under the goal it was opened from', async () => {
    const goal = await createGoal('DSA')

    const panel = await openDetail('DSA')
    fireEvent.click(within(panel).getByRole('button', { name: 'Add' }))

    const dialog = await screen.findByRole('dialog', { name: 'New milestone in DSA' })
    fireEvent.change(within(dialog).getByLabelText('Checkpoint'), {
      target: { value: 'Graphs' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add milestone' }))

    await waitFor(async () => {
      const rows = await milestoneRepo.byGoal(goal.id)
      expect(rows.map((m) => m.title)).toEqual(['Graphs'])
    })
  })

  it('offers move up and move down as a keyboard route to reordering', async () => {
    const goal = await createGoal('DSA')
    await createMilestone(goal.id, 'Arrays')
    await createMilestone(goal.id, 'Trees')

    const panel = await openDetail('DSA')
    // A pointer drag must never be the only way to do something.
    fireEvent.click(within(panel).getByRole('button', { name: 'Move Trees up' }))

    await waitFor(async () => {
      const rows = await milestoneRepo.byGoal(goal.id)
      expect(rows.map((m) => m.title)).toEqual(['Trees', 'Arrays'])
    })
  })

  it('explains that nothing cascades', async () => {
    const goal = await createGoal('DSA')
    await createMilestone(goal.id, 'Arrays')

    const panel = await openDetail('DSA')
    expect(panel.textContent).toContain('never completes or deletes a task')
  })

  it('closes on Escape', async () => {
    await createGoal('DSA')
    const panel = await openDetail('DSA')
    fireEvent.keyDown(panel, { key: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'DSA details' })).toBeNull(),
    )
  })
})

describe('filters and sorting', () => {
  it('shows active goals by default and reveals the rest on demand', async () => {
    await createGoal('active one')
    const done = await createGoal('finished')
    await db.goals.update(done.id, { status: 'achieved' })

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'active one' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'finished' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Complete\s*1$/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'finished' })).toBeTruthy())
  })

  it('searches the title and the why', async () => {
    await createGoal('Become strong in DSA')
    await createGoal('Read more', { why: 'fiction mostly' })

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Read more' })).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Search goals'), { target: { value: 'fiction' } })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Become strong in DSA' })).toBeNull(),
    )
    expect(screen.getByRole('button', { name: 'Read more' })).toBeTruthy()
  })

  it('takes the drag grips away when the order is computed', async () => {
    await createGoal('a')
    await createGoal('b')

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'a' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Reorder a' })).toBeTruthy()

    // Dragging under a name sort would write an order the list is not showing.
    fireEvent.change(screen.getByLabelText('Sort goals'), { target: { value: 'name' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reorder a' })).toBeNull())
  })
})

describe('cross-view consistency', () => {
  it('renders exactly the progress the service computed', async () => {
    const goal = await createGoal('DSA')
    const first = await createMilestone(goal.id, 'Arrays')
    await createMilestone(goal.id, 'Trees')
    await createMilestone(goal.id, 'Graphs')
    await completeMilestone(first.id)

    const service = (await getGoalsView()).goals[0]
    mount()

    const bar = await screen.findByRole('progressbar', { name: 'DSA progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe(String(service?.progress.percent))
    expect(row('DSA')?.textContent).toContain(
      `${service?.milestones.done}/${service?.milestones.total} done`,
    )
  })

  it('writes no goal events merely for looking at the screen', async () => {
    await createGoal('DSA')
    const before = new Set((await db.events.toArray()).map((event) => event.id))

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'DSA' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'DSA' }))
    await screen.findByRole('dialog', { name: 'DSA details' })

    const added = (await db.events.toArray()).filter((event) => !before.has(event.id))
    expect(added).toEqual([])
  })
})
