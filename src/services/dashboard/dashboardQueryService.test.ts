import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, toInstant } from '@/lib/date'
import { platform } from '@/platform'
import { taskRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../../tests/helpers'
import { archiveProject, createProject, deleteProject } from '../projectService'
import { getProjectsView } from '../projectQueryService'
import { createTag } from '../tagService'
import { completeTask, createTask, deleteTask, updateTask } from '../taskService'
import { getTaskCounts, getTaskView } from '../taskQueryService'
import { DASHBOARD_LIMITS, getDashboard } from './dashboardQueryService'

/**
 * The Dashboard view model, assembled from a real database.
 *
 * The recurring assertion in this suite is *agreement*: the Dashboard must
 * report the same overdue count as the Overdue view, the same project progress
 * as the Projects screen, and the same ordering as Today. Those are the tests
 * that would fail if the Dashboard ever grew a definition of its own.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

describe('an empty database', () => {
  it('reports zeroes and every empty state, without throwing', async () => {
    const data = await getDashboard()

    expect(data.today).toBe(TODAY)
    expect(data.summary).toEqual({ open: 0, dueToday: 0, overdue: 0, completedToday: 0 })
    expect(data.nextAction).toBeNull()
    expect(data.overdue).toEqual([])
    expect(data.todayGroups).toEqual([])
    expect(data.upcomingGroups).toEqual([])
    expect(data.projects).toEqual([])
    expect(data.activity).toEqual([])
    expect(data.headline).toBe('Nothing due today.')
  })
})

describe('the summary', () => {
  it('counts open, due today, overdue and completed today', async () => {
    await createTask({ title: 'today', dueDate: TODAY })
    await createTask({ title: 'also today', dueDate: TODAY })
    await createTask({ title: 'late', dueDate: addDays(TODAY, -2) })
    await createTask({ title: 'undated' })
    const done = await createTask({ title: 'finished', dueDate: TODAY })
    await completeTask(done.id)

    const data = await getDashboard()
    expect(data.summary).toEqual({ open: 4, dueToday: 2, overdue: 1, completedToday: 1 })
  })

  it('counts due today strictly, so the tiles do not double-count', async () => {
    await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })
    const data = await getDashboard()

    // The sidebar's "Today" badge deliberately includes overdue; the Dashboard
    // shows the two side by side, so it must not.
    expect(data.summary.dueToday).toBe(0)
    expect(data.summary.overdue).toBe(1)
  })

  it('agrees with the task counts the rest of the app uses', async () => {
    await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })
    await createTask({ title: 'today', dueDate: TODAY })
    await createTask({ title: 'later', dueDate: addDays(TODAY, 3) })
    await createTask({ title: 'undated' })

    const [dashboard, counts] = await Promise.all([getDashboard(), getTaskCounts()])
    expect(dashboard.summary.overdue).toBe(counts.overdue)
    // Open on the dashboard is every incomplete task, which is `all` minus done.
    expect(dashboard.summary.open).toBe(counts.all - counts.completed)
  })

  it('excludes deleted tasks from every figure', async () => {
    const task = await createTask({ title: 'gone', dueDate: TODAY })
    await deleteTask(task.id)

    const data = await getDashboard()
    expect(data.summary).toEqual({ open: 0, dueToday: 0, overdue: 0, completedToday: 0 })
  })

  it('writes a headline that matches its own numbers', async () => {
    await createTask({ title: 'today', dueDate: TODAY })
    await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })

    const data = await getDashboard()
    expect(data.headline).toBe('You have 1 task due today and 1 overdue.')
  })
})

describe('completed today, around the local day boundary', () => {
  /** Completes a task and back-dates the completion to a chosen instant. */
  const completeAt = async (title: string, at: number) => {
    const task = await createTask({ title })
    await completeTask(task.id)
    await taskRepo.update(task.id, { completedAt: at }, { emit: false })
  }

  it('counts a task finished one minute after local midnight', async () => {
    await completeAt('early', toInstant(TODAY, '00:00') + 60_000)
    expect((await getDashboard()).summary.completedToday).toBe(1)
  })

  it('counts a task finished at 23:59 local', async () => {
    await completeAt('late', toInstant(TODAY, '23:59'))
    expect((await getDashboard()).summary.completedToday).toBe(1)
  })

  it('does not count the last instant of yesterday', async () => {
    await completeAt('yesterday', toInstant(TODAY, '00:00') - 1)
    expect((await getDashboard()).summary.completedToday).toBe(0)
  })

  it('does not count the first instant of tomorrow', async () => {
    await completeAt('tomorrow', toInstant(addDays(TODAY, 1), '00:00'))
    expect((await getDashboard()).summary.completedToday).toBe(0)
  })

  it('follows the clock port across midnight rather than the wall clock', async () => {
    await completeAt('tonight', toInstant(TODAY, '22:00'))
    expect((await getDashboard()).summary.completedToday).toBe(1)

    // The same rows, one day later: nothing was completed "today" any more.
    vi.spyOn(platform.clock, 'today').mockReturnValue(addDays(TODAY, 1))
    expect((await getDashboard()).summary.completedToday).toBe(0)
  })
})

describe('the next action', () => {
  it('picks the overdue task and recalculates once it is done', async () => {
    await createTask({ title: 'today', dueDate: TODAY, priority: 'urgent' })
    const late = await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })

    expect((await getDashboard()).nextAction?.title).toBe('late')

    await completeTask(late.id)
    expect((await getDashboard()).nextAction?.title).toBe('today')
  })

  it('never offers a deleted task', async () => {
    const late = await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })
    await createTask({ title: 'today', dueDate: TODAY })
    await deleteTask(late.id)

    expect((await getDashboard()).nextAction?.title).toBe('today')
  })

  it('is null when everything is finished', async () => {
    const task = await createTask({ title: 'only one' })
    await completeTask(task.id)
    expect((await getDashboard()).nextAction).toBeNull()
  })
})

describe('the overdue preview', () => {
  it('matches the Overdue view, in the same order', async () => {
    await createTask({ title: 'oldest', dueDate: addDays(TODAY, -5) })
    await createTask({ title: 'middle', dueDate: addDays(TODAY, -3) })
    await createTask({ title: 'newest', dueDate: addDays(TODAY, -1) })

    const [dashboard, overdueView] = await Promise.all([getDashboard(), getTaskView('overdue')])

    expect(dashboard.overdue.map((task) => task.title)).toEqual(
      overdueView.tasks.map((task) => task.title),
    )
    expect(dashboard.overdue.map((task) => task.title)).toEqual(['oldest', 'middle', 'newest'])
  })

  it('previews a limited number but reports the true total', async () => {
    for (let i = 0; i < DASHBOARD_LIMITS.overdue + 3; i += 1) {
      await createTask({ title: `late ${i}`, dueDate: addDays(TODAY, -(i + 1)) })
    }

    const data = await getDashboard()
    expect(data.overdue).toHaveLength(DASHBOARD_LIMITS.overdue)
    expect(data.overdueTotal).toBe(DASHBOARD_LIMITS.overdue + 3)
  })

  it('drops a task from the preview as soon as it is completed', async () => {
    const late = await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })
    expect((await getDashboard()).overdue).toHaveLength(1)

    await completeTask(late.id)
    const after = await getDashboard()
    expect(after.overdue).toEqual([])
    expect(after.summary.overdue).toBe(0)
    expect(after.summary.completedToday).toBe(1)
  })
})

describe('the today preview', () => {
  it('keeps the Today view ordering: scheduled by time, then anytime', async () => {
    await createTask({ title: 'anytime', dueDate: TODAY })
    await createTask({ title: 'evening', dueDate: TODAY, dueTime: '19:00' })
    await createTask({ title: 'morning', dueDate: TODAY, dueTime: '08:00' })

    const data = await getDashboard()
    expect(data.todayGroups.map((group) => group.label)).toEqual(['Scheduled', 'Anytime today'])
    expect(data.todayGroups.flatMap((group) => group.tasks.map((task) => task.title))).toEqual([
      'morning',
      'evening',
      'anytime',
    ])
  })

  it('leaves overdue rows to the Overdue card, so nothing is listed twice', async () => {
    await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })
    await createTask({ title: 'today', dueDate: TODAY })

    const data = await getDashboard()
    const todayTitles = data.todayGroups.flatMap((g) => g.tasks.map((t) => t.title))

    expect(todayTitles).toEqual(['today'])
    expect(data.overdue.map((task) => task.title)).toEqual(['late'])

    // Together the two cards are exactly what /today renders.
    const todayView = await getTaskView('today')
    expect([...data.overdue, ...data.todayGroups.flatMap((g) => g.tasks)].map((t) => t.title)).toEqual(
      todayView.tasks.map((task) => task.title),
    )
  })

  it('previews a limited number but reports the true total', async () => {
    for (let i = 0; i < DASHBOARD_LIMITS.today + 2; i += 1) {
      await createTask({ title: `task ${i}`, dueDate: TODAY })
    }

    const data = await getDashboard()
    expect(data.todayGroups.flatMap((group) => group.tasks)).toHaveLength(DASHBOARD_LIMITS.today)
    expect(data.todayTotal).toBe(DASHBOARD_LIMITS.today + 2)
  })
})

describe('the upcoming preview', () => {
  it('groups by day, earliest first, and skips empty days', async () => {
    await createTask({ title: 'tomorrow', dueDate: addDays(TODAY, 1) })
    await createTask({ title: 'in three days', dueDate: addDays(TODAY, 3) })

    const data = await getDashboard()
    expect(data.upcomingGroups.map((group) => group.date)).toEqual([
      addDays(TODAY, 1),
      addDays(TODAY, 3),
    ])
    expect(data.upcomingTotal).toBe(2)
  })

  it('excludes today and anything already overdue', async () => {
    await createTask({ title: 'today', dueDate: TODAY })
    await createTask({ title: 'late', dueDate: addDays(TODAY, -1) })
    await createTask({ title: 'tomorrow', dueDate: addDays(TODAY, 1) })

    const data = await getDashboard()
    expect(data.upcomingGroups.flatMap((g) => g.tasks.map((t) => t.title))).toEqual(['tomorrow'])
  })

  it('agrees with the Upcoming view over the days it covers', async () => {
    await createTask({ title: 'tomorrow', dueDate: addDays(TODAY, 1) })
    await createTask({ title: 'day after', dueDate: addDays(TODAY, 2) })

    const [dashboard, upcoming] = await Promise.all([
      getDashboard(),
      getTaskView('upcoming', { upcomingDays: DASHBOARD_LIMITS.upcomingDays }),
    ])

    expect(dashboard.upcomingGroups.flatMap((g) => g.tasks.map((t) => t.title))).toEqual(
      upcoming.tasks.map((task) => task.title),
    )
  })

  it('does not look further ahead than its window', async () => {
    await createTask({ title: 'far away', dueDate: addDays(TODAY, 30) })
    expect((await getDashboard()).upcomingGroups).toEqual([])
  })
})

describe('the project preview', () => {
  it('reports the same progress the Projects screen shows', async () => {
    const college = await createProject('College')
    await createTask({ title: 'a', projectId: college.id })
    const done = await createTask({ title: 'b', projectId: college.id })
    await completeTask(done.id)

    const [dashboard, projectsView] = await Promise.all([getDashboard(), getProjectsView()])

    expect(dashboard.projects[0]?.stats).toEqual(projectsView.active[0]?.stats)
    expect(dashboard.projects[0]?.stats).toMatchObject({ total: 2, completed: 1, progress: 50 })
  })

  it('moves the progress when a project task is completed', async () => {
    const college = await createProject('College')
    await createTask({ title: 'a', projectId: college.id })
    await createTask({ title: 'b', projectId: college.id })

    expect((await getDashboard()).projects[0]?.stats.progress).toBe(0)

    const rows = await taskRepo.byProject(college.id)
    await completeTask(rows[0]!.id)

    expect((await getDashboard()).projects[0]?.stats.progress).toBe(50)
  })

  it('never shows an archived project', async () => {
    const college = await createProject('College')
    await createProject('DSA')
    await archiveProject(college.id)

    const data = await getDashboard()
    expect(data.projects.map((entry) => entry.project.name)).toEqual(['DSA'])
    expect(data.projectsTotal).toBe(1)
  })

  it('never shows a deleted project', async () => {
    const college = await createProject('College')
    await deleteProject(college.id)
    expect((await getDashboard()).projects).toEqual([])
  })

  it('previews a limited number but reports the true total', async () => {
    for (let i = 0; i < DASHBOARD_LIMITS.projects + 2; i += 1) {
      await createProject(`Project ${i}`)
    }

    const data = await getDashboard()
    expect(data.projects).toHaveLength(DASHBOARD_LIMITS.projects)
    expect(data.projectsTotal).toBe(DASHBOARD_LIMITS.projects + 2)
  })
})

describe('recent activity', () => {
  it('reads real events, newest first, with readable labels', async () => {
    const college = await createProject('College')
    const task = await createTask({ title: 'Study Java', projectId: college.id })
    await completeTask(task.id)

    const data = await getDashboard()
    const labels = data.activity.map((entry) => entry.label)

    expect(labels[0]).toBe('Completed Study Java')
    expect(labels).toContain('Added Study Java')
    expect(labels).toContain('Created project College')
  })

  it('links a project entry to the project, and leaves tasks unlinked', async () => {
    const college = await createProject('College')
    const data = await getDashboard()
    const entry = data.activity.find((row) => row.type === 'project.created')

    expect(entry?.href).toBe(`/projects/${college.id}`)
    expect(data.activity.every((row) => row.entityType !== 'task' || row.href === null)).toBe(true)
  })

  it('keeps the recorded title after the task is deleted', async () => {
    const task = await createTask({ title: 'Study Java' })
    await completeTask(task.id)
    await deleteTask(task.id)

    // `task.completed` carries its own title, so history stays readable even
    // though the row can no longer be resolved.
    const data = await getDashboard()
    expect(data.activity.map((entry) => entry.label)).toContain('Completed Study Java')
  })

  it('records the provenance the command layer stamped', async () => {
    await createTask({ title: 'from quick add' }, { source: 'quickadd' })
    const data = await getDashboard()
    expect(data.activity[0]?.source).toBe('quickadd')
  })

  it('limits how much history it loads', async () => {
    for (let i = 0; i < DASHBOARD_LIMITS.activity + 5; i += 1) {
      await createTask({ title: `task ${i}` })
    }
    expect((await getDashboard()).activity).toHaveLength(DASHBOARD_LIMITS.activity)
  })

  it('grows by exactly one event when one thing happens', async () => {
    const task = await createTask({ title: 'Study' })
    const before = (await getDashboard()).eventCount

    await completeTask(task.id)

    // Completing records `task.completed` and nothing else — the Dashboard
    // reads the log, it never writes to it.
    expect((await getDashboard()).eventCount).toBe(before + 1)
  })

  it('writes nothing of its own — reading the dashboard is not an event', async () => {
    await createTask({ title: 'Study' })
    const before = (await getDashboard()).eventCount

    await getDashboard()
    await getDashboard()

    expect((await getDashboard()).eventCount).toBe(before)
  })
})

describe('the context the previews need', () => {
  it('carries tags, projects and subtask progress for the rows on screen', async () => {
    const tag = await createTag('java')
    const college = await createProject('College')
    const task = await createTask({
      title: 'Study Java',
      dueDate: TODAY,
      tagIds: [tag.id],
      projectId: college.id,
      subtasks: ['Read', 'Practise'],
    })

    const data = await getDashboard()
    expect(data.tags.map((row) => row.name)).toEqual(['java'])
    expect(data.allProjects.map((row) => row.name)).toEqual(['College'])
    expect(data.progress.get(task.id)).toEqual({ done: 0, total: 2 })
  })

  it('reports live row counts', async () => {
    await createProject('College')
    await createTask({ title: 'Study' })

    const data = await getDashboard()
    expect(data.counts['tasks']).toBe(1)
    expect(data.counts['projects']).toBe(1)
    expect(data.eventCount).toBeGreaterThan(0)
  })
})

describe('reacting to a change', () => {
  it('moves every affected figure when one task is completed', async () => {
    await createTask({ title: 'today', dueDate: TODAY })
    const second = await createTask({ title: 'also today', dueDate: TODAY })

    const before = await getDashboard()
    expect(before.summary).toMatchObject({ open: 2, dueToday: 2, completedToday: 0 })

    await completeTask(second.id)

    const after = await getDashboard()
    expect(after.summary).toMatchObject({ open: 1, dueToday: 1, completedToday: 1 })
    expect(after.todayGroups.flatMap((g) => g.tasks)).toHaveLength(1)
    expect(after.nextAction?.title).toBe('today')
    expect(after.activity[0]?.label).toBe('Completed also today')
  })

  it('follows a task that is moved into a project', async () => {
    const college = await createProject('College')
    const task = await createTask({ title: 'Study', dueDate: TODAY })

    expect((await getDashboard()).projects[0]?.stats.total).toBe(0)

    await updateTask(task.id, { projectId: college.id })
    expect((await getDashboard()).projects[0]?.stats.total).toBe(1)
  })
})
