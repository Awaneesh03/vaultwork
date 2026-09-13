import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { archiveProject, createProject, executeText } from '@/services'
import { useProjectUiStore } from '@/store/projectUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { ProjectsView } from './ProjectsView'

/**
 * The Projects screen, mounted against a real database.
 *
 * `tests/projectCommandPipeline.test.ts` proves the project domain works with
 * no React; this proves the other half — that the React layer is wired to it.
 * Between them every arrow in
 *
 *   component → hook → service → repository → Dexie
 *
 * is exercised, and a break in the wiring fails CI rather than showing up as a
 * blank screen.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useProjectUiStore.getState().resetForView()
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route path="/projects" element={<ProjectsView />} />
        <Route path="/projects/:projectId" element={<p>project detail</p>} />
      </Routes>
    </MemoryRouter>,
  )

/** The header's button — the empty state offers a second one with the same name. */
const newProjectButton = () => screen.getAllByRole('button', { name: 'New project' })[0]!

/** Opens the composer, fills the name, and submits. */
async function createThroughUi(name: string, extra?: () => void) {
  newProjectButton().click()
  const dialog = await screen.findByRole('dialog', { name: 'New project' })
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: name } })
  extra?.()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
}

describe('the list', () => {
  it('shows a skeleton before the first read resolves', () => {
    const { container } = mount()
    // A placeholder is on screen rather than an empty panel. `DataView`'s own
    // test covers the accessible half; this one only needs the shape.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })

  it('renders each project with its counts and progress', async () => {
    const college = await createProject('College')
    await executeText('Study Java', { source: 'ui', now: NOW, defaultProjectId: college.id })
    await executeText('Read chapter 4', { source: 'ui', now: NOW, defaultProjectId: college.id })
    await executeText('/done Study Java', { source: 'ui', now: NOW })

    mount()

    const row = await waitFor(() => {
      const node = screen.getByText('College').closest('[data-project-id]')
      if (!node) throw new Error('row not rendered yet')
      return node as HTMLElement
    })

    // 2 tasks · 1 done · 1 left, and a bar that reports the same thing.
    expect(within(row).getByText('tasks').parentElement?.textContent).toBe('2 tasks')
    expect(within(row).getByText('done').parentElement?.textContent).toBe('1 done')
    expect(within(row).getByText('left').parentElement?.textContent).toBe('1 left')
    expect(within(row).getByText('50%')).toBeTruthy()

    const bar = within(row).getByRole('progressbar', {
      name: /1 of 2 tasks complete in College/,
    })
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
  })

  it('shows the overdue count when a project has late work', async () => {
    const college = await createProject('College')
    await executeText('Submit lab record 2026-08-30', {
      source: 'ui',
      now: NOW,
      defaultProjectId: college.id,
    })

    mount()
    await waitFor(() => expect(screen.getByText('1 overdue')).toBeTruthy())
  })

  it('says so, rather than showing 0%, for a project with no tasks', async () => {
    await createProject('Untouched')
    mount()
    await waitFor(() => expect(screen.getByText('No tasks yet')).toBeTruthy())
  })

  it('offers a way to make the first project when there are none', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeTruthy())
    // Two entry points: the header and the empty state.
    expect(screen.getAllByRole('button', { name: 'New project' })).toHaveLength(2)
  })
})

describe('creating a project', () => {
  it('writes it through the command layer and shows it in the list', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeTruthy())

    await createThroughUi('College')

    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())
    const rows = await db.projects.toArray()
    expect(rows.map((row) => row.name)).toEqual(['College'])
  })

  it('closes the composer once the project exists', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeTruthy())

    await createThroughUi('College')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('refuses a blank name without writing anything', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeTruthy())

    newProjectButton().click()
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '   ' } })
    within(dialog).getByRole('button', { name: 'Create project' }).click()

    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'A project needs a name',
    )
    expect(await db.projects.count()).toBe(0)
    // The dialog stays open on the field that is wrong.
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeTruthy()
  })

  it('reports a duplicate name instead of creating a second project', async () => {
    await createProject('College')
    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    await createThroughUi('college')

    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0))
    expect(useToastStore.getState().toasts[0]?.message).toMatch(/already exists/i)
    expect(await db.projects.count()).toBe(1)
  })

  it('stores the accent and icon the composer chose', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeTruthy())

    await createThroughUi('College', () => {
      const dialog = screen.getByRole('dialog', { name: 'New project' })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Violet' }))
      fireEvent.click(within(dialog).getByRole('button', { name: 'Study' }))
    })

    await waitFor(async () => {
      const [row] = await db.projects.toArray()
      expect(row).toMatchObject({ color: 'violet', icon: 'graduation-cap' })
    })
  })
})

describe('editing a project', () => {
  it('keeps the id and writes no second row', async () => {
    const project = await createProject('College')
    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    screen.getByRole('button', { name: 'Edit College' }).click()
    const dialog = await screen.findByRole('dialog', { name: 'Edit College' })
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe('College')

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Semester 5' } })
    within(dialog).getByRole('button', { name: 'Save project' }).click()

    await waitFor(() => expect(screen.getByText('Semester 5')).toBeTruthy())
    const rows = await db.projects.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(project.id)
  })

  it('loads the existing description into the form', async () => {
    await createProject('College', { description: 'Coursework and labs' })
    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    screen.getByRole('button', { name: 'Edit College' }).click()
    const dialog = await screen.findByRole('dialog', { name: 'Edit College' })
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Description').value).toBe(
      'Coursework and labs',
    )
  })
})

describe('archiving and restoring', () => {
  it('archives from the row, and the project leaves the active list', async () => {
    const project = await createProject('College')
    await executeText('Study Java', { source: 'ui', now: NOW, defaultProjectId: project.id })

    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    screen.getByRole('button', { name: 'Archive College' }).click()

    await waitFor(() => expect(screen.queryByText('College')).toBeNull())
    expect((await db.projects.get(project.id))?.status).toBe('archived')

    // And the task it held is untouched.
    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.projectId).toBe(project.id)
    expect(tasks[0]?.deletedAt).toBeNull()
  })

  it('finds it under Archived and restores it', async () => {
    const project = await createProject('College')
    await archiveProject(project.id)

    mount()
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeTruthy())

    screen.getByRole('button', { name: /^Archived/ }).click()

    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())
    screen.getByRole('button', { name: 'Restore College' }).click()

    await waitFor(async () => {
      expect((await db.projects.get(project.id))?.status).toBe('active')
    })
  })

  it('says out loud that archiving kept the tasks', async () => {
    const project = await createProject('College')
    await executeText('Study Java', { source: 'ui', now: NOW, defaultProjectId: project.id })

    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())
    screen.getByRole('button', { name: 'Archive College' }).click()

    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0))
    expect(useToastStore.getState().toasts[0]?.message).toContain('1 task kept')
  })
})

describe('deleting a project', () => {
  it('deletes without a dialog, keeps the tasks, and offers an undo', async () => {
    const project = await createProject('College')
    await executeText('Study Java', { source: 'ui', now: NOW, defaultProjectId: project.id })

    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    screen.getByRole('button', { name: 'Delete College' }).click()

    await waitFor(() => expect(screen.queryByText('College')).toBeNull())

    // No confirmation was asked for, and the reversal is on the undo stack.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useToastStore.getState().undoStack[0]).toMatchObject({ kind: 'project.restore' })

    // The project row is stamped, not removed — and the task is entirely intact.
    expect((await db.projects.get(project.id))?.deletedAt).toBeGreaterThan(0)
    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.deletedAt).toBeNull()
    expect(tasks[0]?.projectId).toBe(project.id)
  })
})

describe('search and filters', () => {
  beforeEach(async () => {
    await createProject('Portfolio Site', { description: 'Something for recruiters' })
    const college = await createProject('College')
    await executeText('Submit lab record 2026-08-30', {
      source: 'ui',
      now: NOW,
      defaultProjectId: college.id,
    })
  })

  it('filters the list by name as you type', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Search projects'), {
      target: { value: 'portfolio' },
    })

    await waitFor(() => expect(screen.queryByText('College')).toBeNull())
    expect(screen.getByText('Portfolio Site')).toBeTruthy()
  })

  it('matches the description too', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Search projects'), {
      target: { value: 'recruiters' },
    })

    await waitFor(() => expect(screen.queryByText('College')).toBeNull())
    expect(screen.getByText('Portfolio Site')).toBeTruthy()
  })

  it('explains an empty result caused by a filter, and offers a way out', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Search projects'), {
      target: { value: 'nothing matches this' },
    })

    await waitFor(() => expect(screen.getByText('Nothing matches those filters')).toBeTruthy())
    expect(screen.getByText(/2 projects are hidden/)).toBeTruthy()

    screen.getByRole('button', { name: 'Clear filters' }).click()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())
  })

  it('narrows to projects with overdue work', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('Portfolio Site')).toBeTruthy())

    fireEvent.change(screen.getByDisplayValue('Any progress'), { target: { value: 'overdue' } })

    await waitFor(() => expect(screen.queryByText('Portfolio Site')).toBeNull())
    expect(screen.getByText('College')).toBeTruthy()
  })

  it('sorts by name on request', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    const names = () =>
      screen
        .getAllByRole('progressbar')
        .map((bar) => bar.getAttribute('aria-label') ?? '')
        .join('|')

    fireEvent.change(screen.getByDisplayValue('Manual order'), { target: { value: 'name' } })
    await waitFor(() => expect(names()).toMatch(/College[\s\S]*Portfolio Site/))
  })
})

describe('keyboard safety', () => {
  it('does not fire a global shortcut while typing in the project name', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeTruthy())

    newProjectButton().click()
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    const name = within(dialog).getByLabelText('Name')

    // "e" would open the editor, "A" would archive, "j"/"k" would move the
    // selection — every one of them is a letter in a project name.
    fireEvent.change(name, { target: { value: 'Personal' } })
    for (const key of ['e', 'A', 'j', 'k', 'n', '/', '#', 'Backspace']) {
      fireEvent.keyDown(name, { key })
    }

    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe('Personal')
    expect(useProjectUiStore.getState().selectedProjectId).toBeNull()
    expect(await db.projects.count()).toBe(0)
  })

  it('does not archive or delete while typing in the search box', async () => {
    const project = await createProject('College')
    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    const search = screen.getByLabelText('Search projects')
    for (const key of ['A', 'e', '#', 'Backspace', 'Delete']) {
      fireEvent.keyDown(search, { key })
    }

    const row = await db.projects.get(project.id)
    expect(row?.status).toBe('active')
    expect(row?.deletedAt).toBeNull()
  })

  it('moves the selection with J and K, and opens with Enter', async () => {
    await createProject('First')
    const second = await createProject('Second')

    mount()
    await waitFor(() => expect(screen.getByText('Second')).toBeTruthy())

    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'j' })
    expect(useProjectUiStore.getState().selectedProjectId).toBe(second.id)

    fireEvent.keyDown(window, { key: 'k' })
    expect(useProjectUiStore.getState().selectedProjectId).not.toBe(second.id)

    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('project detail')).toBeTruthy())
  })

  it('archives the selected project with shift+A', async () => {
    const project = await createProject('College')
    mount()
    await waitFor(() => expect(screen.getByText('College')).toBeTruthy())

    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'A' })

    await waitFor(async () => {
      expect((await db.projects.get(project.id))?.status).toBe('archived')
    })
  })
})

describe('reordering', () => {
  it('gives every row a keyboard-reachable drag handle in manual order', async () => {
    await createProject('First')
    await createProject('Second')

    mount()
    await waitFor(() => expect(screen.getByText('Second')).toBeTruthy())

    expect(screen.getByRole('button', { name: 'Reorder First' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reorder Second' })).toBeTruthy()
  })

  it('leaves space and the arrows to the drag while a handle has focus', async () => {
    await createProject('First')
    await createProject('Second')

    mount()
    await waitFor(() => expect(screen.getByText('Second')).toBeTruthy())

    const handle = screen.getByRole('button', { name: 'Reorder First' })
    handle.focus()

    // dnd-kit drives the drag with exactly these keys. If this layer answered
    // them too, ArrowDown would move the selection as well as the row and the
    // space that drops the row would open whatever ended up selected — so
    // finishing a keyboard drag would navigate off the list being sorted.
    for (const key of [' ', 'ArrowDown', 'ArrowUp', ' ']) {
      fireEvent.keyDown(handle, { key })
    }

    expect(useProjectUiStore.getState().selectedProjectId).toBeNull()
    expect(screen.queryByText('project detail')).toBeNull()
  })

  it('still answers those keys from outside a handle', async () => {
    const first = await createProject('First')

    mount()
    await waitFor(() => expect(screen.getByText('First')).toBeTruthy())

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(useProjectUiStore.getState().selectedProjectId).toBe(first.id)
  })

  it('withdraws the handles once a sort other than manual is chosen', async () => {
    await createProject('First')
    await createProject('Second')

    mount()
    await waitFor(() => expect(screen.getByText('Second')).toBeTruthy())

    fireEvent.change(screen.getByDisplayValue('Manual order'), { target: { value: 'name' } })

    // Dragging a list the database is going to re-sort would be a lie.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reorder First' })).toBeNull())
    expect(screen.getByText('Sorted — drag disabled')).toBeTruthy()
  })
})
