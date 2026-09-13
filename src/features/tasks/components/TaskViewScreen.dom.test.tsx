import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import { executeText } from '@/services/commands'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { TaskViewScreen } from './TaskViewScreen'

/**
 * The one test that mounts a real screen against a real database.
 *
 * `tests/commandPipeline.test.ts` proves the command layer works without React;
 * this proves the other half — that the React layer is wired to it. Between
 * them, every arrow in
 *
 *   component → hook → service → repository → Dexie
 *
 * is exercised, and a runtime break in the wiring fails CI rather than showing
 * up as a blank screen.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useTaskUiStore.setState({ selectedTaskId: null, openTaskId: null, quickAddOpen: false })
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mount = (view: 'today' | 'inbox' | 'completed') =>
  render(
    <MemoryRouter>
      <TaskViewScreen view={view} />
    </MemoryRouter>,
  )

describe('Today, rendered from Dexie', () => {
  beforeEach(async () => {
    // An explicit past date: a bare "1 sep" would correctly roll forward to
    // next September and never be overdue at all.
    await executeText('Submit lab record 2026-08-30 !urgent', { source: 'ui', now: NOW })
    await executeText('Study Binary Trees today at 7pm ~45m', { source: 'ui', now: NOW })
    await executeText('Water the plants today', { source: 'ui', now: NOW })
    await executeText('Renew the pass next week', { source: 'ui', now: NOW })
  })

  it('renders the three sections in the specified order', async () => {
    mount('today')

    await waitFor(() => expect(screen.getByText('Overdue')).toBeTruthy())

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent)
    expect(headings).toEqual(['Overdue', 'Scheduled', 'Anytime today'])
  })

  it('shows the tasks that belong there and none that do not', async () => {
    mount('today')

    await waitFor(() => expect(screen.getByText('Study Binary Trees')).toBeTruthy())
    expect(screen.getByText('Submit lab record')).toBeTruthy()
    expect(screen.getByText('Water the plants')).toBeTruthy()
    expect(screen.queryByText('Renew the pass')).toBeNull()
  })

  it('renders the metadata the parser extracted', async () => {
    mount('today')

    await waitFor(() => expect(screen.getByText('7 pm')).toBeTruthy())
    expect(screen.getByText('45m')).toBeTruthy()
    // The estimate total in the header.
    expect(screen.getByText('≈ 45m')).toBeTruthy()
  })

  it('completes a task through the command layer when its checkbox is clicked', async () => {
    mount('today')

    await waitFor(() => expect(screen.getByText('Water the plants')).toBeTruthy())
    screen.getByRole('checkbox', { name: 'Complete Water the plants' }).click()

    // The row leaves Today, and the row in Dexie is genuinely complete.
    await waitFor(() => expect(screen.queryByText('Water the plants')).toBeNull())
    const rows = await db.tasks.toArray()
    expect(rows.find((task) => task.title === 'Water the plants')?.status).toBe('done')
  })

  it('soft-deletes with an undo toast rather than a confirmation dialog', async () => {
    mount('today')

    await waitFor(() => expect(screen.getByText('Water the plants')).toBeTruthy())
    screen.getByRole('button', { name: 'Delete Water the plants' }).click()

    await waitFor(() => expect(screen.queryByText('Water the plants')).toBeNull())

    // No dialog was opened, and the reversal is on the undo stack.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useToastStore.getState().undoStack[0]).toMatchObject({ kind: 'task.restore' })

    // The row is still there, just stamped.
    const rows = await db.tasks.toArray()
    expect(rows.find((task) => task.title === 'Water the plants')?.deletedAt).toBeGreaterThan(0)
  })
})

describe('empty and loading states', () => {
  it('shows a skeleton before the first read resolves', () => {
    const { container } = mount('inbox')
    // A placeholder is on screen rather than an empty panel. `DataView`'s own
    // test covers the accessible half; this one only needs the shape.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })

  it('shows the empty state a view defines, not a blank rectangle', async () => {
    mount('completed')
    await waitFor(() => expect(screen.getByText('Nothing completed yet')).toBeTruthy())
  })

  it('explains an empty result caused by filters, and offers a way out', async () => {
    await executeText('Study Binary Trees', { source: 'ui', now: NOW })
    mount('inbox')

    await waitFor(() => expect(screen.getByText('Study Binary Trees')).toBeTruthy())

    useTaskUiStore.getState().setSearch('quantum mechanics')

    await waitFor(() => expect(screen.getByText('Nothing matches those filters')).toBeTruthy())
    expect(screen.getByText('Clear filters')).toBeTruthy()
  })
})

describe('quick add, wired end to end', () => {
  it('parses as you type and shows what it understood', async () => {
    mount('inbox')
    await waitFor(() => expect(screen.getByLabelText('Quick add a task')).toBeTruthy())

    const input = screen.getByLabelText('Quick add a task') as HTMLInputElement
    // React's controlled input needs its own setter to see a programmatic write.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, 'Study Java tomorrow 7pm !high ~45m')
    input.dispatchEvent(new Event('input', { bubbles: true }))

    await waitFor(() => expect(screen.getByText('Tomorrow')).toBeTruthy())
    expect(screen.getByText('7 pm')).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText('45m')).toBeTruthy()
  })
})
