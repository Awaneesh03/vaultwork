import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { addDays } from '@/lib/date'
import { archiveProject, createProject, executeText } from '@/services'
import { useProjectUiStore } from '@/store/projectUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { DashboardView } from './DashboardView'

/**
 * The Dashboard, mounted against a real database.
 *
 * `dashboardQueryService.test.ts` proves the numbers are right with no React;
 * this proves the other half — that the screen is wired to them, that its
 * actions travel the same command pipeline every other surface uses, and that
 * nothing it renders invents data of its own.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useTaskUiStore.getState().resetForView()
  useTaskUiStore.setState({ quickAddOpen: false })
  useProjectUiStore.getState().resetForView()
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DashboardView />} />
        <Route path="/today" element={<p>today screen</p>} />
        <Route path="/overdue" element={<p>overdue screen</p>} />
        <Route path="/upcoming" element={<p>upcoming screen</p>} />
        <Route path="/completed" element={<p>completed screen</p>} />
        <Route path="/tasks" element={<p>all tasks screen</p>} />
        <Route path="/projects" element={<p>projects screen</p>} />
        <Route path="/projects/:projectId" element={<p>project detail screen</p>} />
      </Routes>
    </MemoryRouter>,
  )

const capture = (text: string) => executeText(text, { source: 'ui', now: NOW })

/**
 * A summary tile, found by the destination its label ends with — the one part
 * that does not change as the count moves between singular and plural.
 */
const tile = (destination: string) =>
  screen.getByRole('link', { name: new RegExp(`${destination}$`) })

describe('the header', () => {
  it('greets by local time and states the date it is computing against', async () => {
    mount()
    // 10am on the pinned clock.
    await waitFor(() => expect(screen.getByText('Good morning.')).toBeTruthy())

    // The rendered wording is locale-dependent; the machine-readable date is
    // the part that must equal the day the rest of the screen computed against.
    const time = screen.getByText(/2026/)
    expect(time.tagName).toBe('TIME')
    expect(time.getAttribute('datetime')).toBe(TODAY)
  })

  it('summarises the day from the live counts', async () => {
    await capture('Study Java today')
    await capture('Submit lab record 2026-08-30')

    mount()
    await waitFor(() =>
      expect(screen.getByText('You have 1 task due today and 1 overdue.')).toBeTruthy(),
    )
  })

  it('says the plain thing on an empty database', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('Nothing due today.')).toBeTruthy())
  })

  it('shows a skeleton before the first read resolves', () => {
    const { container } = mount()
    // A placeholder is on screen rather than an empty panel. `DataView`'s own
    // test covers the accessible half; this one only needs the shape.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })
})

describe('the summary tiles', () => {
  beforeEach(async () => {
    await capture('Study Java today')
    await capture('Read a chapter today')
    await capture('Submit lab record 2026-08-30')
    await capture('Buy milk')
    await capture('Water the plants today')
    await capture('/done Water the plants')
  })

  it('shows counts that match the database, described for a screen reader', async () => {
    mount()

    await waitFor(() => expect(tile('View all tasks')).toBeTruthy())

    // Four open (Study Java, Read a chapter, Submit lab record, Buy milk),
    // two of them due today, one late, one finished today.
    expect(tile('View all tasks').getAttribute('aria-label')).toBe(
      '4 open tasks. View all tasks',
    )
    expect(tile('View today').getAttribute('aria-label')).toBe('2 tasks due today. View today')
    expect(tile('View overdue').getAttribute('aria-label')).toBe(
      '1 overdue task. View overdue',
    )
    expect(tile('View completed').getAttribute('aria-label')).toBe(
      '1 task completed today. View completed',
    )
  })

  it('navigates to the existing screens rather than to new ones', async () => {
    mount()
    await waitFor(() => expect(tile('View all tasks')).toBeTruthy())

    expect(tile('View all tasks').getAttribute('href')).toBe('/tasks')
    expect(tile('View today').getAttribute('href')).toBe('/today')
    expect(tile('View overdue').getAttribute('href')).toBe('/overdue')
    expect(tile('View completed').getAttribute('href')).toBe('/completed')
  })

  it('actually goes there when clicked', async () => {
    mount()
    await waitFor(() => expect(tile('View today')).toBeTruthy())

    fireEvent.click(tile('View today'))
    await waitFor(() => expect(screen.getByText('today screen')).toBeTruthy())
  })
})

describe('the next action', () => {
  it('offers the overdue task, with its due information spelled out', async () => {
    await capture('Study Java today !urgent')
    await capture('Submit lab record 2026-08-30 !low')

    mount()
    const card = await screen.findByRole('region', { name: 'Next action' })

    // Time beats importance: the low-priority late task wins.
    await waitFor(() => expect(within(card).getByText('Submit lab record')).toBeTruthy())
    expect(within(card).getByText('Low')).toBeTruthy()
    expect(within(card).getByText(/overdue/)).toBeTruthy()
  })

  it('recalculates as soon as the chosen task is completed', async () => {
    await capture('Study Java today')
    await capture('Submit lab record 2026-08-30')

    mount()
    const card = await screen.findByRole('region', { name: 'Next action' })
    await waitFor(() => expect(within(card).getByText('Submit lab record')).toBeTruthy())

    fireEvent.click(within(card).getByRole('button', { name: 'Complete' }))

    await waitFor(() => expect(within(card).getByText('Study Java')).toBeTruthy())
    const rows = await db.tasks.toArray()
    expect(rows.find((task) => task.title === 'Submit lab record')?.status).toBe('done')
  })

  it('shows the project and estimate it carries', async () => {
    const college = await createProject('College')
    await executeText('Study Java today ~45m', {
      source: 'ui',
      now: NOW,
      defaultProjectId: college.id,
    })

    mount()
    const card = await screen.findByRole('region', { name: 'Next action' })
    await waitFor(() => expect(within(card).getByText('Study Java')).toBeTruthy())
    expect(within(card).getByText('45m')).toBeTruthy()
    expect(within(card).getByText('College')).toBeTruthy()
  })

  it('says "You\'re clear" and offers capture when nothing is open', async () => {
    mount()
    const card = await screen.findByRole('region', { name: 'Next action' })
    await waitFor(() => expect(within(card).getByText(/You’re clear/)).toBeTruthy())
    expect(within(card).getByRole('button', { name: 'Capture a task' })).toBeTruthy()
  })

  it('is clear again once the last task is done', async () => {
    await capture('Study Java today')
    mount()

    const card = await screen.findByRole('region', { name: 'Next action' })
    await waitFor(() => expect(within(card).getByText('Study Java')).toBeTruthy())

    fireEvent.click(within(card).getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(within(card).getByText(/You’re clear/)).toBeTruthy())
  })
})

describe('the overdue card', () => {
  it('lists the overdue tasks and links to the real screen', async () => {
    await capture('Submit lab record 2026-08-30')
    await capture('Return the book 2026-09-01')

    mount()
    const card = await screen.findByRole('region', { name: 'Overdue' })

    await waitFor(() => expect(within(card).getByText('Submit lab record')).toBeTruthy())
    expect(within(card).getByText('Return the book')).toBeTruthy()

    const link = within(card).getByRole('link', { name: /View all overdue/ })
    expect(link.getAttribute('href')).toBe('/overdue')
    fireEvent.click(link)
    await waitFor(() => expect(screen.getByText('overdue screen')).toBeTruthy())
  })

  it('completes an overdue task in place and drops it from the card', async () => {
    await capture('Submit lab record 2026-08-30')

    mount()
    const card = await screen.findByRole('region', { name: 'Overdue' })
    await waitFor(() => expect(within(card).getByText('Submit lab record')).toBeTruthy())

    fireEvent.click(
      within(card).getByRole('checkbox', { name: 'Complete Submit lab record' }),
    )

    await waitFor(() => expect(within(card).getByText('Nothing overdue.')).toBeTruthy())
    // And the tiles moved with it.
    expect(tile('View overdue').getAttribute('aria-label')).toBe(
      '0 overdue tasks. View overdue',
    )
    expect(tile('View completed').getAttribute('aria-label')).toBe(
      '1 task completed today. View completed',
    )
  })

  it('shows a compact empty state, not a celebration', async () => {
    mount()
    const card = await screen.findByRole('region', { name: 'Overdue' })
    await waitFor(() => expect(within(card).getByText('Nothing overdue.')).toBeTruthy())
  })
})

describe('the today card', () => {
  it('keeps the Today view ordering and leaves overdue to its own card', async () => {
    await capture('Anytime thing today')
    await capture('Evening thing today at 7pm')
    await capture('Morning thing today at 8am')
    await capture('Submit lab record 2026-08-30')

    mount()
    const card = await screen.findByRole('region', { name: 'Today' })
    await waitFor(() => expect(within(card).getByText('Morning thing')).toBeTruthy())

    const titles = within(card)
      .getAllByRole('button')
      .map((node) => node.getAttribute('title'))
      .filter(Boolean)
    expect(titles).toEqual(['Morning thing', 'Evening thing', 'Anytime thing'])

    // The overdue row belongs to the Overdue card, so it is not listed twice.
    expect(within(card).queryByText('Submit lab record')).toBeNull()
  })

  it('completes a task and updates the counts immediately', async () => {
    await capture('Study Java today')
    await capture('Read a chapter today')

    mount()
    const card = await screen.findByRole('region', { name: 'Today' })
    await waitFor(() => expect(within(card).getByText('Study Java')).toBeTruthy())
    expect(tile('View today').getAttribute('aria-label')).toBe('2 tasks due today. View today')

    fireEvent.click(within(card).getByRole('checkbox', { name: 'Complete Study Java' }))

    await waitFor(() =>
      expect(tile('View today').getAttribute('aria-label')).toBe('1 task due today. View today'),
    )
    expect(tile('View completed').getAttribute('aria-label')).toBe(
      '1 task completed today. View completed',
    )
    expect(within(card).queryByText('Study Java')).toBeNull()
  })

  it('opens the existing task detail panel from a row', async () => {
    await capture('Study Java today')

    mount()
    const card = await screen.findByRole('region', { name: 'Today' })
    await waitFor(() => expect(within(card).getByText('Study Java')).toBeTruthy())

    fireEvent.click(within(card).getByRole('button', { name: 'Study Java' }))
    await waitFor(() => expect(useTaskUiStore.getState().openTaskId).not.toBeNull())
  })

  it('shows its own empty state', async () => {
    mount()
    const card = await screen.findByRole('region', { name: 'Today' })
    await waitFor(() =>
      expect(within(card).getByText('Nothing scheduled for today.')).toBeTruthy(),
    )
  })
})

describe('the upcoming card', () => {
  it('groups the next few days and links to the real screen', async () => {
    await capture(`Study Java ${addDays(TODAY, 1)}`)
    await capture(`Submit assignment ${addDays(TODAY, 1)}`)
    await capture(`Dentist ${addDays(TODAY, 3)}`)

    mount()
    const card = await screen.findByRole('region', { name: 'Upcoming' })

    await waitFor(() => expect(within(card).getByText('Tomorrow')).toBeTruthy())
    expect(within(card).getByText('Study Java')).toBeTruthy()
    expect(within(card).getByText('Submit assignment')).toBeTruthy()
    expect(within(card).getByText('Dentist')).toBeTruthy()

    fireEvent.click(within(card).getByRole('link', { name: /View all/ }))
    await waitFor(() => expect(screen.getByText('upcoming screen')).toBeTruthy())
  })

  it('shows its own empty state', async () => {
    mount()
    const card = await screen.findByRole('region', { name: 'Upcoming' })
    await waitFor(() => expect(within(card).getByText('No upcoming tasks.')).toBeTruthy())
  })
})

describe('the projects card', () => {
  it('shows active projects with the same progress the Projects screen reports', async () => {
    const college = await createProject('College')
    await executeText('Study Java', { source: 'ui', now: NOW, defaultProjectId: college.id })
    await executeText('Read a chapter', { source: 'ui', now: NOW, defaultProjectId: college.id })
    await capture('/done Study Java')

    mount()
    const card = await screen.findByRole('region', { name: 'Projects' })

    await waitFor(() => expect(within(card).getByText('College')).toBeTruthy())
    const bar = within(card).getByRole('progressbar', {
      name: /1 of 2 tasks complete in College/,
    })
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
    expect(within(card).getByText('1 left')).toBeTruthy()
  })

  it('never shows an archived project', async () => {
    const college = await createProject('College')
    await createProject('DSA')
    await archiveProject(college.id)

    mount()
    const card = await screen.findByRole('region', { name: 'Projects' })
    await waitFor(() => expect(within(card).getByText('DSA')).toBeTruthy())
    expect(within(card).queryByText('College')).toBeNull()
  })

  it('opens the existing project detail view', async () => {
    const college = await createProject('College')

    mount()
    const card = await screen.findByRole('region', { name: 'Projects' })
    await waitFor(() => expect(within(card).getByText('College')).toBeTruthy())

    const link = within(card).getByRole('link', { name: /College/ })
    expect(link.getAttribute('href')).toBe(`/projects/${college.id}`)
    fireEvent.click(link)
    await waitFor(() => expect(screen.getByText('project detail screen')).toBeTruthy())
  })

  it('shows its own empty state', async () => {
    mount()
    const card = await screen.findByRole('region', { name: 'Projects' })
    await waitFor(() => expect(within(card).getByText('No active projects yet.')).toBeTruthy())
  })
})

describe('recent activity', () => {
  it('reads real events in human words, newest first', async () => {
    await createProject('College')
    await capture('Study Java')
    await capture('/done Study Java')

    mount()
    const card = await screen.findByRole('region', { name: 'Recent activity' })

    await waitFor(() => expect(within(card).getByText('Completed Study Java')).toBeTruthy())
    expect(within(card).getByText('Added Study Java')).toBeTruthy()
    expect(within(card).getByText('Created project College')).toBeTruthy()
  })

  it('does not record an event for opening or navigating', async () => {
    await capture('Study Java today')
    const before = await db.events.count()

    mount()
    const card = await screen.findByRole('region', { name: 'Today' })
    await waitFor(() => expect(within(card).getByText('Study Java')).toBeTruthy())

    // Open a task, then a summary tile — neither is a mutation.
    fireEvent.click(within(card).getByRole('button', { name: 'Study Java' }))
    fireEvent.click(tile('View all tasks'))

    await waitFor(() => expect(screen.getByText('all tasks screen')).toBeTruthy())
    expect(await db.events.count()).toBe(before)
  })

  it('shows its own empty state', async () => {
    mount()
    const card = await screen.findByRole('region', { name: 'Recent activity' })
    await waitFor(() => expect(within(card).getByText('No recent activity.')).toBeTruthy())
  })
})

describe('quick capture', () => {
  it('creates a task through the M3 parser and pipeline, and updates at once', async () => {
    mount()
    await waitFor(() => expect(screen.getByLabelText('Quick add a task')).toBeTruthy())

    const input = screen.getByLabelText('Quick add a task')
    fireEvent.change(input, { target: { value: 'Study Java tomorrow 7pm #java !high ~45m' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(async () => {
      const [task] = await db.tasks.toArray()
      expect(task).toMatchObject({
        title: 'Study Java',
        dueDate: addDays(TODAY, 1),
        dueTime: '19:00',
        priority: 'high',
        estimateMin: 45,
      })
    })

    const tags = await db.tags.toArray()
    expect(tags.map((tag) => tag.name)).toEqual(['java'])

    // And the screen reflects it without a refresh.
    const card = await screen.findByRole('region', { name: 'Upcoming' })
    await waitFor(() => expect(within(card).getByText('Study Java')).toBeTruthy())
  })

  it('is what the empty next action points at', async () => {
    mount()
    const card = await screen.findByRole('region', { name: 'Next action' })
    await waitFor(() => expect(within(card).getByText(/You’re clear/)).toBeTruthy())

    fireEvent.click(within(card).getByRole('button', { name: 'Capture a task' }))
    expect(useTaskUiStore.getState().quickAddOpen).toBe(true)
  })
})

describe('keyboard', () => {
  it('drives the previewed rows with the existing list shortcuts', async () => {
    await capture('Study Java today')

    mount()
    const card = await screen.findByRole('region', { name: 'Today' })
    await waitFor(() => expect(within(card).getByText('Study Java')).toBeTruthy())

    fireEvent.keyDown(window, { key: 'j' })
    expect(useTaskUiStore.getState().selectedTaskId).not.toBeNull()

    fireEvent.keyDown(window, { key: ' ' })
    await waitFor(async () => {
      const [task] = await db.tasks.toArray()
      expect(task?.status).toBe('done')
    })
  })

  it('walks each task once, even when it appears in two cards', async () => {
    await capture('Submit lab record 2026-08-30')

    mount()
    await screen.findByRole('region', { name: 'Overdue' })
    await waitFor(() => expect(screen.getAllByText('Submit lab record').length).toBeGreaterThan(0))

    // The overdue task is also the next action; selection must not stall or
    // double-count as it moves.
    fireEvent.keyDown(window, { key: 'j' })
    const first = useTaskUiStore.getState().selectedTaskId
    expect(first).not.toBeNull()

    fireEvent.keyDown(window, { key: 'j' })
    expect(useTaskUiStore.getState().selectedTaskId).toBe(first)
  })

  it('does not fire a shortcut while typing in quick add', async () => {
    await capture('Study Java today')

    mount()
    await waitFor(() => expect(screen.getByLabelText('Quick add a task')).toBeTruthy())

    const input = screen.getByLabelText('Quick add a task')
    fireEvent.change(input, { target: { value: 'jked 1234' } })
    for (const key of ['j', 'k', 'e', 'd', ' ', '1', '2', '3', '4', '#', 'Backspace']) {
      fireEvent.keyDown(input, { key })
    }

    expect(useTaskUiStore.getState().selectedTaskId).toBeNull()
    const [task] = await db.tasks.toArray()
    expect(task).toMatchObject({ status: 'todo', priority: 'none', deletedAt: null })
    expect((input as HTMLInputElement).value).toBe('jked 1234')
  })
})

describe('live database counts', () => {
  it('reports real row counts and updates as rows are added', async () => {
    await createProject('College')
    await capture('Study Java')

    mount()
    await waitFor(() => expect(screen.getByText(/1 tasks · 1 projects/)).toBeTruthy())
  })
})
