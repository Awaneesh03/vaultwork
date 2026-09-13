import { beforeEach, describe, expect, it } from 'vitest'
import { taskRepo } from '@/repositories'
import { addDays } from '@/lib/date'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import {
  getProjectCounts,
  getProjectDetail,
  getProjectsView,
  searchProjects,
} from './projectQueryService'
import { archiveProject, createProject, deleteProject } from './projectService'
import { createTag } from './tagService'
import { addSubtask, completeTask, createTask, updateTask } from './taskService'
import { getTaskCounts, getTaskView } from './taskQueryService'

/** Thursday 3 September 2026 — the date the M3 suites are pinned to. */
const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

describe('the Projects view', () => {
  it('reports zeroes and empty lists on a fresh database', async () => {
    const view = await getProjectsView()

    expect(view.today).toBe(TODAY)
    expect(view.active).toEqual([])
    expect(view.archived).toEqual([])
    expect(view.activeTotal).toBe(0)
    expect(view.totals.total).toBe(0)
    expect(view.totals.progress).toBe(0)
  })

  it('lists active projects in manual order with their derived counts', async () => {
    const college = await createProject('College')
    const dsa = await createProject('DSA')

    await createTask({ title: 'a', projectId: college.id })
    const done = await createTask({ title: 'b', projectId: college.id })
    await completeTask(done.id)
    await createTask({ title: 'c', projectId: dsa.id })

    const view = await getProjectsView()

    expect(view.active.map((entry) => entry.project.name)).toEqual(['College', 'DSA'])
    expect(view.active[0]?.stats).toMatchObject({
      total: 2,
      completed: 1,
      remaining: 1,
      progress: 50,
    })
    expect(view.active[1]?.stats).toMatchObject({ total: 1, completed: 0, progress: 0 })
  })

  it('includes a project with no tasks, at 0%', async () => {
    await createProject('Empty')
    const view = await getProjectsView()

    expect(view.active).toHaveLength(1)
    expect(view.active[0]?.stats).toMatchObject({ total: 0, progress: 0 })
  })

  it('counts overdue tasks per project, ignoring completed ones', async () => {
    const project = await createProject('College')
    await createTask({ title: 'late', projectId: project.id, dueDate: addDays(TODAY, -2) })
    const lateButDone = await createTask({
      title: 'was late',
      projectId: project.id,
      dueDate: addDays(TODAY, -3),
    })
    await completeTask(lateButDone.id)
    await createTask({ title: 'today', projectId: project.id, dueDate: TODAY })
    await createTask({ title: 'later', projectId: project.id, dueDate: addDays(TODAY, 5) })

    const view = await getProjectsView()
    expect(view.active[0]?.stats).toMatchObject({ overdue: 1, dueToday: 1, scheduled: 3 })
  })

  it('excludes soft-deleted tasks from the numbers', async () => {
    const project = await createProject('College')
    await createTask({ title: 'kept', projectId: project.id })
    const gone = await createTask({ title: 'gone', projectId: project.id })
    await taskRepo.softDelete(gone.id)

    const view = await getProjectsView()
    expect(view.active[0]?.stats.total).toBe(1)
  })

  it('splits archived projects into their own list, only when asked for', async () => {
    const college = await createProject('College')
    await createProject('DSA')
    await archiveProject(college.id)

    const active = await getProjectsView()
    expect(active.active.map((entry) => entry.project.name)).toEqual(['DSA'])
    expect(active.archived).toEqual([])
    expect(active.activeTotal).toBe(1)
    expect(active.archivedTotal).toBe(1)

    const archived = await getProjectsView({ filter: { state: 'archived' } })
    expect(archived.active).toEqual([])
    expect(archived.archived.map((entry) => entry.project.name)).toEqual(['College'])

    const all = await getProjectsView({ filter: { state: 'all' } })
    expect(all.active).toHaveLength(1)
    expect(all.archived).toHaveLength(1)
  })

  it('keeps the tasks of an archived project in its counts', async () => {
    const project = await createProject('College')
    await createTask({ title: 'Study', projectId: project.id })
    await archiveProject(project.id)

    const view = await getProjectsView({ filter: { state: 'archived' } })
    expect(view.archived[0]?.stats.total).toBe(1)
  })

  it('drops a deleted project from every list', async () => {
    const project = await createProject('College')
    await deleteProject(project.id)

    const view = await getProjectsView({ filter: { state: 'all' } })
    expect(view.active).toEqual([])
    expect(view.archived).toEqual([])
  })

  it('counts the Inbox as open tasks with no project', async () => {
    const project = await createProject('College')
    await createTask({ title: 'filed', projectId: project.id })
    await createTask({ title: 'unfiled' })
    const doneUnfiled = await createTask({ title: 'unfiled and done' })
    await completeTask(doneUnfiled.id)

    const view = await getProjectsView()
    expect(view.inboxCount).toBe(1)
  })

  it('rolls totals up across tasks, not by averaging percentages', async () => {
    const big = await createProject('Big')
    const small = await createProject('Small')

    // 1 of 3 done in Big, 1 of 1 in Small. The task-weighted answer is 2/4;
    // averaging the percentages would say (33 + 100) / 2 = 67.
    await createTask({ title: 'a', projectId: big.id })
    await createTask({ title: 'b', projectId: big.id })
    const bigDone = await createTask({ title: 'c', projectId: big.id })
    await completeTask(bigDone.id)
    const smallDone = await createTask({ title: 'd', projectId: small.id })
    await completeTask(smallDone.id)

    const view = await getProjectsView()
    expect(view.totals).toMatchObject({ total: 4, completed: 2, remaining: 2, progress: 50 })
  })

  it('sorts on request without changing what is included', async () => {
    await createProject('Beta')
    await createProject('Alpha')

    const manual = await getProjectsView({ sort: 'manual' })
    expect(manual.active.map((entry) => entry.project.name)).toEqual(['Beta', 'Alpha'])

    const byName = await getProjectsView({ sort: 'name' })
    expect(byName.active.map((entry) => entry.project.name)).toEqual(['Alpha', 'Beta'])
  })

  it('filters without changing the pre-filter totals', async () => {
    const late = await createProject('Late')
    await createProject('Fine')
    await createTask({ title: 'a', projectId: late.id, dueDate: addDays(TODAY, -1) })

    const view = await getProjectsView({ filter: { progress: 'overdue' } })
    expect(view.active.map((entry) => entry.project.name)).toEqual(['Late'])
    // The header still knows how many there really are, so an empty result can
    // say "2 projects are hidden" rather than "you have no projects".
    expect(view.activeTotal).toBe(2)
  })

  it('searches name and description', async () => {
    await createProject('Portfolio Site', { description: 'Something for recruiters' })
    await createProject('College')

    const byName = await getProjectsView({ filter: { search: 'portfolio' } })
    expect(byName.active.map((entry) => entry.project.name)).toEqual(['Portfolio Site'])

    const byDescription = await getProjectsView({ filter: { search: 'recruiters' } })
    expect(byDescription.active.map((entry) => entry.project.name)).toEqual(['Portfolio Site'])

    const noMatch = await getProjectsView({ filter: { search: 'nothing here' } })
    expect(noMatch.active).toEqual([])
  })
})

describe('searchProjects', () => {
  it('returns nothing for a blank query rather than everything', async () => {
    await createProject('College')
    expect(await searchProjects('   ')).toEqual([])
  })

  it('searches the archive too', async () => {
    const project = await createProject('College')
    await archiveProject(project.id)

    expect((await searchProjects('college')).map((entry) => entry.project.name)).toEqual([
      'College',
    ])
  })
})

describe('getProjectCounts', () => {
  it('counts active, archived, and how many need attention', async () => {
    const late = await createProject('Late')
    await createProject('Fine')
    const old = await createProject('Old')
    await archiveProject(old.id)
    await createTask({ title: 'a', projectId: late.id, dueDate: addDays(TODAY, -1) })

    expect(await getProjectCounts()).toEqual({ active: 2, archived: 1, withOverdue: 1 })
  })
})

describe('the project detail view', () => {
  it('returns undefined for a project that does not exist', async () => {
    expect(await getProjectDetail('nope')).toBeUndefined()
  })

  it('returns undefined for a deleted project', async () => {
    const project = await createProject('College')
    await deleteProject(project.id)
    expect(await getProjectDetail(project.id)).toBeUndefined()
  })

  it('groups open work before completed work', async () => {
    const project = await createProject('College')
    await createTask({ title: 'open one', projectId: project.id })
    const done = await createTask({ title: 'finished', projectId: project.id })
    await completeTask(done.id)

    const detail = await getProjectDetail(project.id)
    expect(detail?.groups.map((group) => group.label)).toEqual(['Open', 'Completed'])
    expect(detail?.groups[0]?.tasks.map((task) => task.title)).toEqual(['open one'])
    expect(detail?.groups[1]?.tasks.map((task) => task.title)).toEqual(['finished'])
  })

  it('drops an empty section rather than rendering a heading over nothing', async () => {
    const project = await createProject('College')
    await createTask({ title: 'open', projectId: project.id })

    const detail = await getProjectDetail(project.id)
    expect(detail?.groups.map((group) => group.label)).toEqual(['Open'])
  })

  it('never shows a task belonging to another project', async () => {
    const college = await createProject('College')
    const dsa = await createProject('DSA')
    await createTask({ title: 'mine', projectId: college.id })
    await createTask({ title: 'theirs', projectId: dsa.id })
    await createTask({ title: 'nobody' })

    const detail = await getProjectDetail(college.id)
    expect(detail?.tasks.map((task) => task.title)).toEqual(['mine'])
  })

  it('carries the stats, the estimate and the subtask progress', async () => {
    const project = await createProject('College')
    const task = await createTask({ title: 'Study', projectId: project.id, estimateMin: 45 })
    await addSubtask(task.id, 'Read')
    const sub = await addSubtask(task.id, 'Practise')
    await createTask({ title: 'late', projectId: project.id, dueDate: addDays(TODAY, -1) })

    const detail = await getProjectDetail(project.id)
    expect(detail?.stats).toMatchObject({ total: 2, remaining: 2, overdue: 1, progress: 0 })
    expect(detail?.totalEstimateMin).toBe(45)
    expect(detail?.progress.get(task.id)).toEqual({ done: 0, total: 2 })
    expect(sub.taskId).toBe(task.id)
  })

  it('does not let a filter move the progress bar', async () => {
    const project = await createProject('College')
    await createTask({ title: 'keep', projectId: project.id })
    const done = await createTask({ title: 'hide me', projectId: project.id })
    await completeTask(done.id)

    const detail = await getProjectDetail(project.id, { filter: { search: 'keep' } })

    // The list narrowed; the stats describe the project, not the list.
    expect(detail?.tasks).toHaveLength(1)
    expect(detail?.stats).toMatchObject({ total: 2, completed: 1, progress: 50 })
    expect(detail?.unfilteredCount).toBe(2)
  })

  it('applies the task filters M3 already defines', async () => {
    const project = await createProject('College')
    const tag = await createTag('java')
    await createTask({ title: 'tagged', projectId: project.id, tagIds: [tag.id] })
    await createTask({ title: 'urgent one', projectId: project.id, priority: 'urgent' })
    await createTask({ title: 'plain', projectId: project.id })

    const byTag = await getProjectDetail(project.id, { filter: { tagIds: [tag.id] } })
    expect(byTag?.tasks.map((task) => task.title)).toEqual(['tagged'])

    const byPriority = await getProjectDetail(project.id, { filter: { priorities: ['urgent'] } })
    expect(byPriority?.tasks.map((task) => task.title)).toEqual(['urgent one'])

    const bySearch = await getProjectDetail(project.id, { filter: { search: 'plain' } })
    expect(bySearch?.tasks.map((task) => task.title)).toEqual(['plain'])
  })

  it('ignores a projectId in the incoming filter — the project is the view', async () => {
    const college = await createProject('College')
    const dsa = await createProject('DSA')
    await createTask({ title: 'mine', projectId: college.id })
    await createTask({ title: 'theirs', projectId: dsa.id })

    const detail = await getProjectDetail(college.id, { filter: { projectId: dsa.id } })
    expect(detail?.tasks.map((task) => task.title)).toEqual(['mine'])
  })

  it('sorts on request, and stops the Open section being draggable', async () => {
    const project = await createProject('College')
    await createTask({ title: 'b', projectId: project.id, dueDate: addDays(TODAY, 5) })
    await createTask({ title: 'a', projectId: project.id, dueDate: TODAY })

    const manual = await getProjectDetail(project.id)
    expect(manual?.tasks.map((task) => task.title)).toEqual(['b', 'a'])
    expect(manual?.groups[0]?.sortable).toBe(true)

    const sorted = await getProjectDetail(project.id, { sort: 'dueDate' })
    expect(sorted?.tasks.map((task) => task.title)).toEqual(['a', 'b'])
    expect(sorted?.groups[0]?.sortable).toBe(false)
  })

  it('offers every open task not already here as assignable', async () => {
    const college = await createProject('College')
    const dsa = await createProject('DSA')
    await createTask({ title: 'mine', projectId: college.id })
    await createTask({ title: 'theirs', projectId: dsa.id })
    await createTask({ title: 'unfiled' })
    const finished = await createTask({ title: 'done elsewhere' })
    await completeTask(finished.id)

    const detail = await getProjectDetail(college.id)
    expect(detail?.assignable.map((task) => task.title).sort()).toEqual(['theirs', 'unfiled'])
  })

  it('shows the tasks of an archived project unchanged', async () => {
    const project = await createProject('College')
    await createTask({ title: 'Study', projectId: project.id })
    await archiveProject(project.id)

    const detail = await getProjectDetail(project.id)
    expect(detail?.project.status).toBe('archived')
    expect(detail?.tasks.map((task) => task.title)).toEqual(['Study'])
  })
})

describe('the task/project relationship', () => {
  it('assigns an unfiled task to a project', async () => {
    const project = await createProject('College')
    const task = await createTask({ title: 'Study' })

    await updateTask(task.id, { projectId: project.id })

    const detail = await getProjectDetail(project.id)
    expect(detail?.tasks.map((row) => row.title)).toEqual(['Study'])
  })

  it('moves a task from one project to another, leaving the first empty', async () => {
    const college = await createProject('College')
    const dsa = await createProject('DSA')
    const task = await createTask({ title: 'Study', projectId: college.id })

    await updateTask(task.id, { projectId: dsa.id })

    expect((await getProjectDetail(college.id))?.tasks).toEqual([])
    expect((await getProjectDetail(dsa.id))?.tasks.map((row) => row.title)).toEqual(['Study'])
  })

  it('removes a project from a task without deleting the task', async () => {
    const project = await createProject('College')
    const task = await createTask({ title: 'Study', projectId: project.id })

    await updateTask(task.id, { projectId: null })

    const after = await taskRepo.get(task.id)
    expect(after).toBeDefined()
    expect(after?.deletedAt).toBeNull()
    expect(after?.projectId).toBeNull()
    expect((await getProjectDetail(project.id))?.tasks).toEqual([])
  })

  it('keeps the M3 project filter working on the task views', async () => {
    const project = await createProject('College')
    await createTask({ title: 'filed', projectId: project.id })
    await createTask({ title: 'unfiled' })

    const filtered = await getTaskView('all', { filter: { projectId: project.id } })
    expect(filtered.tasks.map((task) => task.title)).toEqual(['filed'])
  })

  it('keeps Inbox meaning "no project" — before and after assignment', async () => {
    const project = await createProject('College')
    const task = await createTask({ title: 'Study' })
    await createTask({ title: 'Also unfiled' })

    const before = await getTaskView('inbox')
    expect(before.tasks.map((row) => row.title)).toEqual(['Study', 'Also unfiled'])
    expect((await getTaskCounts()).inbox).toBe(2)

    await updateTask(task.id, { projectId: project.id })

    const after = await getTaskView('inbox')
    expect(after.tasks.map((row) => row.title)).toEqual(['Also unfiled'])
    expect((await getTaskCounts()).inbox).toBe(1)
  })

  it('does not put a task back in the Inbox when its project is deleted', async () => {
    const project = await createProject('College')
    await createTask({ title: 'Study', projectId: project.id })
    await deleteProject(project.id)

    // The reference survives, which is what makes restore reversible — so the
    // task is still filed, and the Inbox is still "tasks with no project".
    const inbox = await getTaskView('inbox')
    expect(inbox.tasks).toEqual([])
    expect((await getTaskCounts()).inbox).toBe(0)

    // And it is still reachable in the view that shows everything.
    const all = await getTaskView('all')
    expect(all.tasks.map((task) => task.title)).toEqual(['Study'])
  })
})
