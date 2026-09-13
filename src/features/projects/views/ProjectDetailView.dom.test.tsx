import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { archiveProject, createProject, executeText } from '@/services'
import { useProjectUiStore } from '@/store/projectUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import type { Id } from '@/types/entities'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { ProjectDetailView } from './ProjectDetailView'

/**
 * One project's screen, mounted against a real database.
 *
 * The point of most of these is that the task half of the screen is the M3 task
 * system and nothing else: the same rows, the same quick add, the same
 * shortcuts, the same command pipeline. What is genuinely new — capture landing
 * in this project, and the archive/delete promises about tasks — is what the
 * rest of them pin down.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useProjectUiStore.getState().resetForView()
  useTaskUiStore.getState().resetForView()
  useTaskUiStore.setState({ quickAddOpen: false })
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mount = (projectId: Id) =>
  render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route path="/projects" element={<p>all projects list</p>} />
        <Route path="/projects/:projectId" element={<ProjectDetailView />} />
      </Routes>
    </MemoryRouter>,
  )

const capture = (text: string, defaultProjectId?: Id) =>
  executeText(text, {
    source: 'ui',
    now: NOW,
    ...(defaultProjectId === undefined ? {} : { defaultProjectId }),
  })

async function project(name = 'College', description?: string) {
  return createProject(name, description === undefined ? {} : { description })
}

describe('the header', () => {
  it('shows the name, description, status and deadline', async () => {
    const college = await createProject('College', {
      description: 'Coursework and labs',
      status: 'planning',
      deadline: '2026-12-31',
    })

    mount(college.id)

    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())
    expect(screen.getByText('Coursework and labs')).toBeTruthy()
    expect(screen.getByText('Planning')).toBeTruthy()
    expect(screen.getByText(/due /)).toBeTruthy()
  })

  it('says so when the project does not exist', async () => {
    mount('no-such-project')
    await waitFor(() => expect(screen.getByText('No such project')).toBeTruthy())
    // And reassures the reader that its tasks were not destroyed.
    expect(screen.getByText(/Its tasks were not/)).toBeTruthy()
  })
})

describe('the counts', () => {
  it('reports tasks, done, remaining, overdue and progress', async () => {
    const college = await project()
    await capture('Study Java', college.id)
    await capture('Read chapter 4', college.id)
    await capture('Submit lab record 2026-08-30', college.id)
    await capture('/done Study Java')

    mount(college.id)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'College' })).toBeTruthy())

    const metric = (label: string) =>
      screen.getByText(label).parentElement?.textContent?.replace(label, '')

    expect(metric('Tasks')).toBe('3')
    expect(metric('Done')).toBe('1')
    expect(metric('Remaining')).toBe('2')
    expect(metric('Overdue')).toBe('1')

    const bar = screen.getByRole('progressbar', { name: /1 of 3 tasks complete in College/ })
    expect(bar.getAttribute('aria-valuenow')).toBe('33')
  })

  it('moves the progress bar when a task is completed on screen', async () => {
    const college = await project()
    await capture('Study Java', college.id)
    await capture('Read chapter 4', college.id)

    mount(college.id)

    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Study Java' }))

    await waitFor(() =>
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50'),
    )
  })

  it('shows the overdue count as its own warning', async () => {
    const college = await project()
    await capture('Submit lab record 2026-08-30', college.id)

    mount(college.id)
    await waitFor(() => expect(screen.getByText('1 overdue')).toBeTruthy())
  })
})

describe('the task list', () => {
  it('groups open work before completed work', async () => {
    const college = await project()
    await capture('Study Java', college.id)
    await capture('Read chapter 4', college.id)
    await capture('/done Read chapter 4')

    mount(college.id)

    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())
    // Scoped to the task groupings: the screen carries other level-3 headings
    // (the backlinks section, for one), and this test is about task order.
    const groups = screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent)
      .filter((text) => text === 'Open' || text === 'Completed')
    expect(groups).toEqual(['Open', 'Completed'])
  })

  it('shows no task from another project', async () => {
    const college = await project('College')
    const dsa = await project('DSA')
    await capture('Study Java', college.id)
    await capture('Solve arrays', dsa.id)
    await capture('Buy milk')

    mount(college.id)

    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())
    expect(screen.queryByText('Solve arrays')).toBeNull()
    expect(screen.queryByText('Buy milk')).toBeNull()
  })

  it('offers to pull in existing tasks when the project is empty', async () => {
    const college = await project()
    mount(college.id)

    await waitFor(() => expect(screen.getByText('No tasks in here yet')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Add existing tasks' })).toBeTruthy()
  })

  it('does not offer a project filter — the project is the filter', async () => {
    const college = await project()
    await capture('Study Java', college.id)

    mount(college.id)
    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))

    // The panel is open — the due filter proves it — and it has no project select.
    await waitFor(() => expect(screen.getByDisplayValue('Any date')).toBeTruthy())
    expect(screen.queryByDisplayValue('Any project')).toBeNull()
    expect(screen.queryByText('No project')).toBeNull()
  })

  it('filters the tasks in here by search', async () => {
    const college = await project()
    await capture('Study Java', college.id)
    await capture('Read chapter 4', college.id)

    mount(college.id)
    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'java' } })

    await waitFor(() => expect(screen.queryByText('Read chapter 4')).toBeNull())
    expect(screen.getByText('Study Java')).toBeTruthy()
    // The bar still describes the project, not the filtered list.
    expect(screen.getByRole('progressbar', { name: /0 of 2 tasks/ })).toBeTruthy()
  })
})

describe('capture inside a project', () => {
  it('files a quick-added task under this project, parsing everything else', async () => {
    const college = await project()
    mount(college.id)

    await waitFor(() => expect(screen.getByLabelText('Quick add a task')).toBeTruthy())

    const input = screen.getByLabelText('Quick add a task')
    fireEvent.change(input, { target: { value: 'Study Java tomorrow 7pm #java ~45m' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    // The specification's own example, straight out of Dexie.
    const [task] = await db.tasks.toArray()
    expect(task).toMatchObject({
      title: 'Study Java',
      projectId: college.id,
      dueDate: '2026-09-04',
      dueTime: '19:00',
      estimateMin: 45,
    })
    const tags = await db.tags.toArray()
    expect(tags.map((tag) => tag.name)).toEqual(['java'])
    expect(task?.tagIds).toEqual([tags[0]?.id])
  })

  it('files a composer-created task under this project too', async () => {
    const college = await project()
    mount(college.id)

    await waitFor(() => expect(screen.getByLabelText('Quick add a task')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Revise trees' } })
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))

    await waitFor(async () => {
      const [task] = await db.tasks.toArray()
      expect(task).toMatchObject({ title: 'Revise trees', projectId: college.id })
    })
  })

  it('lets an explicit @project override the screen it was typed on', async () => {
    const college = await project('College')
    const dsa = await project('DSA')
    mount(college.id)

    await waitFor(() => expect(screen.getByLabelText('Quick add a task')).toBeTruthy())

    const input = screen.getByLabelText('Quick add a task')
    fireEvent.change(input, { target: { value: 'Solve arrays @DSA' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(async () => {
      const [task] = await db.tasks.toArray()
      expect(task?.projectId).toBe(dsa.id)
    })
  })
})

describe('managing which tasks belong here', () => {
  it('adds an existing task and removes one, without deleting either', async () => {
    const college = await project()
    await capture('Study Java', college.id)
    await capture('Buy milk')

    mount(college.id)
    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Manage tasks' }))
    const picker = await screen.findByRole('dialog', { name: 'Manage tasks in College' })

    fireEvent.click(within(picker).getByRole('button', { name: 'Add Buy milk to College' }))
    await waitFor(async () => {
      const rows = await db.tasks.toArray()
      expect(rows.find((task) => task.title === 'Buy milk')?.projectId).toBe(college.id)
    })

    fireEvent.click(within(picker).getByRole('button', { name: 'Remove Study Java from College' }))
    await waitFor(async () => {
      const rows = await db.tasks.toArray()
      expect(rows.find((task) => task.title === 'Study Java')?.projectId).toBeNull()
    })

    // Neither task was destroyed by being moved.
    const rows = await db.tasks.toArray()
    expect(rows).toHaveLength(2)
    expect(rows.every((task) => task.deletedAt === null)).toBe(true)
  })

  it('never offers a task that is already here as something to add', async () => {
    const college = await project()
    await capture('Study Java', college.id)

    mount(college.id)
    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Manage tasks' }))
    const picker = await screen.findByRole('dialog', { name: 'Manage tasks in College' })

    expect(within(picker).queryByRole('button', { name: /^Add Study Java/ })).toBeNull()
    expect(within(picker).getByText('Every open task is already here.')).toBeTruthy()
  })
})

describe('archive, restore and delete', () => {
  it('archives the project and keeps every task on screen', async () => {
    const college = await project()
    await capture('Study Java', college.id)

    mount(college.id)
    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Archive College' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore College' })).toBeTruthy(),
    )
    expect(screen.getByText(/Every task below is still here/)).toBeTruthy()
    expect(screen.getByText('Study Java')).toBeTruthy()

    const tasks = await db.tasks.toArray()
    expect(tasks[0]?.projectId).toBe(college.id)
    expect(tasks[0]?.deletedAt).toBeNull()
  })

  it('restores an archived project from its own page', async () => {
    const college = await project()
    await archiveProject(college.id)

    mount(college.id)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore College' })).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Restore College' }))

    await waitFor(async () => {
      expect((await db.projects.get(college.id))?.status).toBe('active')
    })
  })

  it('deletes the project, keeps its tasks, and returns to the list', async () => {
    const college = await project()
    await capture('Study Java', college.id)

    mount(college.id)
    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Delete College' }))

    // Staying on a page whose project is gone would show a dead end.
    await waitFor(() => expect(screen.getByText('all projects list')).toBeTruthy())

    expect((await db.projects.get(college.id))?.deletedAt).toBeGreaterThan(0)
    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.deletedAt).toBeNull()
    expect(useToastStore.getState().undoStack[0]).toMatchObject({ kind: 'project.restore' })
  })

  it('edits the project in place from its own page', async () => {
    const college = await project()
    mount(college.id)
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Edit College' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit College' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Semester 5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save project' }))

    await waitFor(() => expect(screen.getByText('Semester 5')).toBeTruthy())
    const rows = await db.projects.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(college.id)
  })
})

describe('keyboard safety', () => {
  it('does not act on the list while the quick add bar has focus', async () => {
    const college = await project()
    await capture('Study Java', college.id)

    mount(college.id)
    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    const input = screen.getByLabelText('Quick add a task')
    fireEvent.change(input, { target: { value: 'Do everything' } })
    // Every one of these is bound to something in the list layer.
    for (const key of ['j', 'k', 'e', 'd', ' ', '1', 'Backspace']) {
      fireEvent.keyDown(input, { key })
    }

    expect(useTaskUiStore.getState().selectedTaskId).toBeNull()
    const [task] = await db.tasks.toArray()
    expect(task).toMatchObject({ status: 'todo', priority: 'none', deletedAt: null })
  })

  it('does not act on the list while the project composer is open', async () => {
    const college = await project()
    await capture('Study Java', college.id)

    mount(college.id)
    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Edit College' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit College' })
    const name = within(dialog).getByLabelText('Name')

    fireEvent.change(name, { target: { value: 'Semester 5' } })
    for (const key of ['j', 'k', 'e', ' ', '1']) {
      fireEvent.keyDown(name, { key })
    }

    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe('Semester 5')
    const [task] = await db.tasks.toArray()
    expect(task?.status).toBe('todo')
  })

  it('still drives the list from outside a field', async () => {
    const college = await project()
    await capture('Study Java', college.id)

    mount(college.id)
    await waitFor(() => expect(screen.getByText('Study Java')).toBeTruthy())

    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: ' ' })

    await waitFor(async () => {
      const [task] = await db.tasks.toArray()
      expect(task?.status).toBe('done')
    })
  })
})
