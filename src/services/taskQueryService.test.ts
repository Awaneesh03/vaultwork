import { beforeEach, describe, expect, it } from 'vitest'
import { taskRepo } from '@/repositories'
import type { Task } from '@/types/entities'
import { formatDayLabel } from '@/lib/date'
import { taskInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { getTaskCounts, getTaskDetail, getTaskView, searchTasks } from './taskQueryService'
import { addSubtask, completeTask, createTask } from './taskService'
import { createProject } from './projectService'
import { createTag } from './tagService'
import {
  DEFAULT_TASK_FILTER,
  PRIORITY_RANK,
  filterTasks,
  isFilterActive,
  matchesSearch,
  sortTasks,
} from './tasks/taskFilters'
import { groupToday, groupUpcoming } from './tasks/taskViews'

/** Thursday 3 September 2026 — see the parser tests for why this date. */
const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  order = 0
})

/**
 * Writes a row without an event, so view tests are not also event tests.
 *
 * Each row gets its own `sortOrder`: leaving them all equal would make manual
 * order depend on UUID ordering inside the index, and the assertions below
 * would pass or fail at random.
 */
let order = 0
function row(title: string, extra: Partial<Task> = {}) {
  order += 1000
  return taskRepo.create(taskInput({ title, sortOrder: order, ...extra }), { emit: false })
}

// ------------------------------------------------------------- pure grouping

describe('Today puts what is late above what is merely due', () => {
  const tasks = [
    { title: 'Untimed', dueDate: TODAY, dueTime: null, sortOrder: 1000 },
    { title: 'Late', dueDate: '2026-09-01', dueTime: null, sortOrder: 2000 },
    { title: 'Evening', dueDate: TODAY, dueTime: '19:00', sortOrder: 3000 },
    { title: 'Morning', dueDate: TODAY, dueTime: '08:00', sortOrder: 4000 },
    { title: 'Older', dueDate: '2026-08-28', dueTime: null, sortOrder: 5000 },
  ].map((t) => taskInput(t) as unknown as Task)

  const groups = groupToday(tasks, TODAY)

  it('produces overdue, then scheduled, then unscheduled', () => {
    expect(groups.map((group) => group.id)).toEqual(['overdue', 'scheduled', 'unscheduled'])
  })

  it('orders overdue by how late it is, oldest first', () => {
    expect(groups[0]?.tasks.map((t) => t.title)).toEqual(['Older', 'Late'])
  })

  it('orders the scheduled section by wall-clock time', () => {
    expect(groups[1]?.tasks.map((t) => t.title)).toEqual(['Morning', 'Evening'])
  })

  it('leaves the untimed tasks in manual order at the bottom', () => {
    expect(groups[2]?.tasks.map((t) => t.title)).toEqual(['Untimed'])
  })

  it('refuses to let a drag reorder the overdue section', () => {
    // Its order is "how late is it"; a manual override would hide the oldest.
    expect(groups[0]?.sortable).toBe(false)
    expect(groups[2]?.sortable).toBe(true)
  })

  it('says how late the oldest overdue task is', () => {
    expect(groups[0]?.hint).toBe('up to 6 days late')
  })

  it('drops sections that would be empty', () => {
    const onlyOverdue = groupToday([tasks[1] as Task], TODAY)
    expect(onlyOverdue.map((g) => g.id)).toEqual(['overdue'])
  })
})

describe('Upcoming is a rolling window that keeps its empty days', () => {
  const tasks = [
    taskInput({ title: 'Tomorrow', dueDate: '2026-09-04' }),
    taskInput({ title: 'Far out', dueDate: '2026-09-30' }),
  ] as unknown as Task[]

  it('starts tomorrow and runs for fourteen days by default', () => {
    const groups = groupUpcoming(tasks, TODAY)
    expect(groups).toHaveLength(14)
    expect(groups[0]?.date).toBe('2026-09-04')
    expect(groups[13]?.date).toBe('2026-09-17')
  })

  it('clamps the window to the 7–14 day range', () => {
    expect(groupUpcoming(tasks, TODAY, 3)).toHaveLength(7)
    expect(groupUpcoming(tasks, TODAY, 30)).toHaveLength(14)
  })

  it('keeps a day with nothing on it, because a visible gap is a fillable gap', () => {
    const groups = groupUpcoming(tasks, TODAY)
    expect(groups[1]?.tasks).toEqual([])
    expect(groups[1]?.keepWhenEmpty).toBe(true)
  })

  it('excludes anything outside the window', () => {
    const inWindow = groupUpcoming(tasks, TODAY).flatMap((g) => g.tasks)
    expect(inWindow.map((t) => t.title)).toEqual(['Tomorrow'])
  })

  it('labels the near days by name and the far ones by date', () => {
    expect(formatDayLabel(TODAY, TODAY)).toBe('Today')
    expect(formatDayLabel('2026-09-04', TODAY)).toBe('Tomorrow')
    expect(formatDayLabel('2026-09-06', TODAY)).toBe('Sunday')
    expect(formatDayLabel('2026-09-17', TODAY)).toBe('Thu 17 Sep')
  })
})

// ---------------------------------------------------------------- filtering

describe('filters', () => {
  const tasks = [
    taskInput({ title: 'A', priority: 'urgent', dueDate: '2026-09-01', estimateMin: 30 }),
    taskInput({ title: 'B', priority: 'low', dueDate: TODAY }),
    taskInput({ title: 'C', priority: 'none', dueDate: null, status: 'done' }),
    taskInput({ title: 'D', priority: 'high', dueDate: '2026-10-01', estimateMin: 60 }),
  ] as unknown as Task[]

  const run = (patch: Partial<typeof DEFAULT_TASK_FILTER>) =>
    filterTasks(tasks, { ...DEFAULT_TASK_FILTER, status: 'all', ...patch }, TODAY).map(
      (t) => t.title,
    )

  it('filters by status', () => {
    expect(run({ status: 'todo' })).toEqual(['A', 'B', 'D'])
    expect(run({ status: 'done' })).toEqual(['C'])
  })

  it('filters by priority', () => {
    expect(run({ priorities: ['urgent', 'high'] })).toEqual(['A', 'D'])
  })

  it('filters by due date, overdue and unscheduled', () => {
    expect(run({ due: 'today' })).toEqual(['B'])
    expect(run({ due: 'overdue' })).toEqual(['A'])
    expect(run({ due: 'unscheduled' })).toEqual(['C'])
    expect(run({ due: 'week' })).toEqual(['A', 'B'])
  })

  it('filters by whether there is an estimate', () => {
    expect(run({ hasEstimate: 'yes' })).toEqual(['A', 'D'])
    expect(run({ hasEstimate: 'no' })).toEqual(['B', 'C'])
  })

  it('filters by an explicit day range', () => {
    expect(run({ dueFrom: TODAY, dueTo: '2026-09-30' })).toEqual(['B'])
  })

  it('applies every constraint at once', () => {
    expect(run({ status: 'todo', priorities: ['high'], hasEstimate: 'yes' })).toEqual(['D'])
  })

  it('knows when it is doing nothing', () => {
    expect(isFilterActive(DEFAULT_TASK_FILTER)).toBe(false)
    expect(isFilterActive({ ...DEFAULT_TASK_FILTER, due: 'overdue' })).toBe(true)
  })

  it('excludes a task with no project when a project is required', () => {
    const withProject = [taskInput({ title: 'P', projectId: 'p1' })] as unknown as Task[]
    expect(
      filterTasks(withProject, { ...DEFAULT_TASK_FILTER, projectId: null }, TODAY),
    ).toHaveLength(0)
    expect(
      filterTasks(withProject, { ...DEFAULT_TASK_FILTER, projectId: 'p1' }, TODAY),
    ).toHaveLength(1)
  })

  it('matches any or all of a tag set', () => {
    const tagged = [
      taskInput({ title: 'Both', tagIds: ['t1', 't2'] }),
      taskInput({ title: 'One', tagIds: ['t1'] }),
    ] as unknown as Task[]

    expect(
      filterTasks(tagged, { ...DEFAULT_TASK_FILTER, tagIds: ['t1', 't2'] }, TODAY).map(
        (t) => t.title,
      ),
    ).toEqual(['Both', 'One'])

    expect(
      filterTasks(
        tagged,
        { ...DEFAULT_TASK_FILTER, tagIds: ['t1', 't2'], tagMode: 'all' },
        TODAY,
      ).map((t) => t.title),
    ).toEqual(['Both'])
  })
})

describe('sorting', () => {
  const tasks = [
    taskInput({ title: 'A', priority: 'low', dueDate: '2026-09-10', sortOrder: 3000 }),
    taskInput({ title: 'B', priority: 'urgent', dueDate: null, sortOrder: 1000 }),
    taskInput({ title: 'C', priority: 'medium', dueDate: '2026-09-04', sortOrder: 2000 }),
  ] as unknown as Task[]

  it('sorts by manual order', () => {
    expect(sortTasks(tasks, 'manual').map((t) => t.title)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by due date, putting undated last in both directions', () => {
    expect(sortTasks(tasks, 'dueDate', 'asc').map((t) => t.title)).toEqual(['C', 'A', 'B'])
    // Reversing must not float the undated task to the top.
    expect(sortTasks(tasks, 'dueDate', 'desc').map((t) => t.title)).toEqual(['B', 'A', 'C'])
  })

  it('sorts by priority, most urgent first', () => {
    expect(sortTasks(tasks, 'priority', 'desc').map((t) => t.title)).toEqual(['B', 'C', 'A'])
    expect(PRIORITY_RANK.urgent).toBeGreaterThan(PRIORITY_RANK.high)
  })

  it('puts a timed task before an untimed one on the same day', () => {
    const sameDay = [
      taskInput({ title: 'Untimed', dueDate: TODAY, dueTime: null, sortOrder: 1000 }),
      taskInput({ title: 'Timed', dueDate: TODAY, dueTime: '09:00', sortOrder: 2000 }),
    ] as unknown as Task[]
    expect(sortTasks(sameDay, 'dueDate').map((t) => t.title)).toEqual(['Timed', 'Untimed'])
  })

  it('does not mutate the array it was given', () => {
    const original = [...tasks]
    sortTasks(tasks, 'priority')
    expect(tasks).toEqual(original)
  })
})

describe('search', () => {
  const index = {
    tagNames: new Map([['t1', 'java']]),
    projectNames: new Map([['p1', 'dsa mastery']]),
  }
  const task = taskInput({
    title: 'Binary Trees',
    description: 'Traversals and rotations',
    tagIds: ['t1'],
    projectId: 'p1',
  }) as unknown as Task

  it('matches on the title', () => {
    expect(matchesSearch(task, 'binary', index)).toBe(true)
  })

  it('matches on the description', () => {
    expect(matchesSearch(task, 'rotations', index)).toBe(true)
  })

  it('matches on a tag name', () => {
    expect(matchesSearch(task, 'java', index)).toBe(true)
  })

  it('matches on the project name', () => {
    expect(matchesSearch(task, 'mastery', index)).toBe(true)
  })

  it('requires every term, across different fields', () => {
    expect(matchesSearch(task, 'java trees', index)).toBe(true)
    expect(matchesSearch(task, 'java quantum', index)).toBe(false)
  })

  it('treats an empty query as matching everything', () => {
    expect(matchesSearch(task, '   ', index)).toBe(true)
  })
})

// ------------------------------------------------------------ the live views

describe('the six views against real rows', () => {
  beforeEach(async () => {
    const project = await createProject('DSA Mastery')
    await row('Inbox item')
    await row('Overdue thing', { dueDate: '2026-08-30', priority: 'urgent' })
    await row('Due today', { dueDate: TODAY, dueTime: '19:00' })
    await row('Next week', { dueDate: '2026-09-08' })
    await row('Far future', { dueDate: '2026-12-01' })
    await row('In a project', { projectId: project.id })
    const finished = await row('Already done')
    await completeTask(finished.id)
  })

  it('Inbox shows only open tasks with no project', async () => {
    const view = await getTaskView('inbox')
    expect(view.tasks.map((t) => t.title)).toEqual([
      'Inbox item',
      'Overdue thing',
      'Due today',
      'Next week',
      'Far future',
    ])
  })

  it('Today shows overdue and due-today, and nothing later', async () => {
    const view = await getTaskView('today')
    expect(view.tasks.map((t) => t.title)).toEqual(['Overdue thing', 'Due today'])
    expect(view.groups.map((g) => g.id)).toEqual(['overdue', 'scheduled'])
  })

  it('Upcoming starts tomorrow, so today never appears twice', async () => {
    const view = await getTaskView('upcoming')
    const titles = view.tasks.map((t) => t.title)
    expect(titles).toEqual(['Next week'])
    expect(titles).not.toContain('Due today')
    expect(titles).not.toContain('Far future')
  })

  it('Overdue shows only what is late', async () => {
    const view = await getTaskView('overdue')
    expect(view.tasks.map((t) => t.title)).toEqual(['Overdue thing'])
  })

  it('Completed shows finished tasks grouped by the day they were finished', async () => {
    const view = await getTaskView('completed')
    expect(view.tasks.map((t) => t.title)).toEqual(['Already done'])
    expect(view.groups[0]?.label).toBe('Today')
  })

  it('Completed can be narrowed to a recent window', async () => {
    const empty = await getTaskView('completed', { filter: { completedWithin: 0 } })
    expect(empty.tasks.map((t) => t.title)).toEqual(['Already done'])
  })

  it('All Tasks shows everything live, open and done alike', async () => {
    const view = await getTaskView('all')
    expect(view.tasks).toHaveLength(7)
    expect(view.tasks.map((t) => t.title)).toContain('Already done')
    expect(view.tasks.map((t) => t.title)).toContain('In a project')
  })

  it('reports the total estimate of the open tasks on screen', async () => {
    await row('Estimated', { dueDate: TODAY, estimateMin: 45 })
    const view = await getTaskView('today')
    expect(view.totalEstimateMin).toBe(45)
  })

  it('carries the tags and projects the rows need for rendering', async () => {
    const view = await getTaskView('all')
    expect(view.projects.map((p) => p.name)).toEqual(['DSA Mastery'])
    expect(view.today).toBe(TODAY)
  })

  it('applies a filter on top of the view', async () => {
    const view = await getTaskView('all', { filter: { priorities: ['urgent'] } })
    expect(view.tasks.map((t) => t.title)).toEqual(['Overdue thing'])
    expect(view.unfilteredCount).toBe(7)
  })

  it('flattens Today when a sort is chosen, rather than fighting the sections', async () => {
    const view = await getTaskView('today', { sort: 'priority', direction: 'desc' })
    expect(view.groups).toHaveLength(1)
    expect(view.tasks.map((t) => t.title)).toEqual(['Overdue thing', 'Due today'])
  })

  it('excludes a soft-deleted task from every view', async () => {
    const [first] = await getTaskView('inbox').then((v) => v.tasks)
    await taskRepo.softDelete(first!.id, { emit: false })

    const after = await getTaskView('inbox')
    expect(after.tasks.map((t) => t.title)).not.toContain(first!.title)
  })

  it('reports subtask progress for the rows on screen', async () => {
    const [first] = await getTaskView('inbox').then((v) => v.tasks)
    const sub = await addSubtask(first!.id, 'Step one')
    await addSubtask(first!.id, 'Step two')
    await completeTask(first!.id).catch(() => undefined)

    const view = await getTaskView('all')
    expect(view.progress.get(first!.id)).toEqual({ done: 0, total: 2 })
    expect(sub.taskId).toBe(first!.id)
  })
})

describe('counts and search over real rows', () => {
  it('counts each view in one pass', async () => {
    await row('Inbox item')
    await row('Overdue thing', { dueDate: '2026-08-30' })
    await row('Due today', { dueDate: TODAY })
    await row('Next week', { dueDate: '2026-09-08' })
    const done = await row('Done')
    await completeTask(done.id)

    expect(await getTaskCounts()).toEqual({
      inbox: 4,
      today: 2,
      upcoming: 1,
      overdue: 1,
      completed: 1,
      all: 5,
    })
  })

  it('searches across title, description, tag and project', async () => {
    const tag = await createTag('java')
    const project = await createProject('DSA Mastery')
    await createTask({ title: 'Binary trees', description: 'Traversals' })
    await createTask({ title: 'Set up Gradle', tagIds: [tag.id] })
    await createTask({ title: 'Contest practice', projectId: project.id })

    expect((await searchTasks('traversals')).map((t) => t.title)).toEqual(['Binary trees'])
    expect((await searchTasks('java')).map((t) => t.title)).toEqual(['Set up Gradle'])
    expect((await searchTasks('mastery')).map((t) => t.title)).toEqual(['Contest practice'])
    expect(await searchTasks('   ')).toEqual([])
  })

  it('puts open tasks before completed ones in the results', async () => {
    const done = await createTask({ title: 'Trees revision' })
    await completeTask(done.id)
    await createTask({ title: 'Trees practice' })

    expect((await searchTasks('trees')).map((t) => t.status)).toEqual(['todo', 'done'])
  })
})

describe('task detail', () => {
  it('returns the task with its subtasks, live tags and project', async () => {
    const tag = await createTag('dsa')
    const project = await createProject('DSA Mastery')
    const task = await createTask({
      title: 'Study trees',
      tagIds: [tag.id],
      projectId: project.id,
      subtasks: ['Inorder', 'Preorder'],
    })

    const detail = await getTaskDetail(task.id)
    expect(detail?.task.title).toBe('Study trees')
    expect(detail?.subtasks.map((s) => s.title)).toEqual(['Inorder', 'Preorder'])
    expect(detail?.tags.map((t) => t.name)).toEqual(['dsa'])
    expect(detail?.project?.name).toBe('DSA Mastery')
  })

  it('returns nothing for a task that does not exist', async () => {
    expect(await getTaskDetail('00000000-0000-4000-8000-000000000000')).toBeUndefined()
  })
})
