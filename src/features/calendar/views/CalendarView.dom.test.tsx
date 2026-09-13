import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { addDays } from '@/lib/date'
import { createProject, executeText } from '@/services'
import { useCalendarUiStore } from '@/store/calendarUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { CalendarView } from './CalendarView'

/**
 * The Calendar, mounted against a real database.
 *
 * `calendarQueryService.test.ts` proves the placement rules with no React;
 * this proves the screen is wired to them — and, just as importantly, that the
 * calendar's mutations travel the same command pipeline as every other surface
 * rather than writing to Dexie behind its back.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useCalendarUiStore.getState().reset()
  useTaskUiStore.getState().resetForView()
  useTaskUiStore.setState({ quickAddOpen: false })
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mount = (path = '/calendar') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CalendarView />
    </MemoryRouter>,
  )

const capture = (text: string) => executeText(text, { source: 'ui', now: NOW })

/** Waits for the grid to have drawn. */
const grid = () => screen.findByRole('grid')

describe('the month view', () => {
  it('shows a skeleton, then the current month', async () => {
    const { container } = mount()
    // A placeholder is on screen rather than an empty panel. `DataView`'s own
    // test covers the accessible half; this one only needs the shape.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)

    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy())
  })

  it('draws seven weekday columns starting on the configured day', async () => {
    mount()
    await grid()

    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(7)
    // Settings seed `weekStartsOn: 1`.
    expect(headers[0]?.textContent).toContain('Mon')
    expect(headers[6]?.textContent).toContain('Sun')
  })

  it('gives every cell an accessible label naming its date and load', async () => {
    await capture('Study Java 2026-09-10')
    mount()
    await grid()

    expect(screen.getByRole('gridcell', { name: /Thursday, 10 Sep 2026, 1 task/ })).toBeTruthy()
    expect(screen.getByRole('gridcell', { name: /Friday, 11 Sep 2026, no tasks/ })).toBeTruthy()
  })

  it('marks today in words as well as in colour', async () => {
    mount()
    await grid()
    expect(screen.getByRole('gridcell', { name: /Thursday, 3 Sep 2026, today/ })).toBeTruthy()
  })

  it('places a task on its own date and nowhere else', async () => {
    await capture('Study Java 2026-09-10')
    mount()
    await grid()

    const tenth = screen.getByRole('gridcell', { name: /10 Sep 2026/ })
    expect(within(tenth).getByRole('button', { name: /^Study Java,/ })).toBeTruthy()

    const eleventh = screen.getByRole('gridcell', { name: /11 Sep 2026/ })
    expect(within(eleventh).queryByRole('button', { name: /^Study Java,/ })).toBeNull()
  })

  it('shows adjacent-month days, and marks them as outside the month', async () => {
    // 31 August is in September 2026's Monday-start grid.
    await capture('Previous month thing 2026-08-31')
    mount()
    await grid()

    const cell = screen.getByRole('gridcell', { name: /31 Aug 2026/ })
    expect(within(cell).getByRole('button', { name: /^Previous month thing,/ })).toBeTruthy()
  })

  it('says a task is overdue in its accessible name, not just in red', async () => {
    await capture('Submit lab record 2026-09-01')
    mount()
    await grid()

    expect(screen.getByRole('button', { name: /Submit lab record.*overdue/ })).toBeTruthy()
  })

  it('says a task is completed rather than removing it from the day', async () => {
    await capture('Study Java today')
    await capture('/done Study Java')

    mount()
    await grid()

    // Still on its date, and described as complete.
    expect(screen.getByRole('button', { name: /Study Java.*completed/ })).toBeTruthy()
  })

  it('collapses a busy day into "+N more" rather than growing the cell', async () => {
    for (let i = 1; i <= 6; i += 1) await capture(`Task ${i} 2026-09-10`)

    mount()
    await grid()

    const cell = screen.getByRole('gridcell', { name: /10 Sep 2026, 6 tasks/ })
    // Three chips fit; the rest collapse.
    expect(within(cell).getByRole('button', { name: /Show all 6 tasks/ })).toBeTruthy()
  })

  it('opens the day when the overflow is clicked', async () => {
    for (let i = 1; i <= 6; i += 1) await capture(`Task ${i} 2026-09-10`)

    mount()
    await grid()
    fireEvent.click(screen.getByRole('button', { name: /Show all 6 tasks/ }))

    // The store moves synchronously with the click; assert that first so the
    // behaviour is checked deterministically rather than by racing a render.
    expect(useCalendarUiStore.getState().mode).toBe('day')
    expect(useCalendarUiStore.getState().selectedDate).toBe('2026-09-10')

    // The day view then runs a fresh live query. Under a fully parallel suite
    // that can exceed waitFor's 1s default on a loaded machine, so this one is
    // given room — the assertion is unchanged, only the patience.
    await waitFor(() => expect(screen.getByText('Thursday, 10 Sep 2026')).toBeTruthy(), {
      timeout: 5000,
    })
  })
})

describe('navigation', () => {
  it('moves to the previous and next month, and back to today', async () => {
    mount()
    await grid()

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }))
    await waitFor(() => expect(screen.getByText('October 2026')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    await waitFor(() => expect(screen.getByText('August 2026')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy())
    expect(useCalendarUiStore.getState().selectedDate).toBe(TODAY)
  })

  it('does not skip a short month when stepping from the 31st', async () => {
    mount()
    await grid()
    useCalendarUiStore.getState().goTo('2026-01-31')

    await waitFor(() => expect(screen.getByText('January 2026')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }))
    await waitFor(() => expect(screen.getByText('February 2026')).toBeTruthy())
  })
})

describe('view switching', () => {
  it('switches between month, week and day', async () => {
    mount()
    await grid()

    fireEvent.click(screen.getByRole('button', { name: /^Week/ }))
    await waitFor(() => expect(screen.getByText('31 Aug – 6 Sep 2026')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^Day/ }))
    await waitFor(() => expect(screen.getByText('Thursday, 3 Sep 2026')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^Month/ }))
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy())
  })

  it('reports which view is current to assistive technology', async () => {
    mount()
    await grid()

    const group = screen.getByRole('group', { name: 'Calendar view' })
    const month = within(group).getByRole('button', { name: /^Month/ })
    expect(month.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(within(group).getByRole('button', { name: /^Week/ }))
    await waitFor(() =>
      expect(
        within(group).getByRole('button', { name: /^Week/ }).getAttribute('aria-pressed'),
      ).toBe('true'),
    )
  })

  it('takes its starting view from the ?view= entry point', async () => {
    mount('/calendar?view=week')
    await waitFor(() => expect(screen.getByText('31 Aug – 6 Sep 2026')).toBeTruthy())
    expect(useCalendarUiStore.getState().mode).toBe('week')
  })
})

describe('the week and day views', () => {
  it('places a timed task at its hour and an all-day task in the gutter', async () => {
    await capture('Evening study today at 7pm')
    await capture('Anytime thing today')

    mount()
    await grid()
    fireEvent.click(screen.getByRole('button', { name: /^Day/ }))

    await waitFor(() => expect(screen.getByText('All day')).toBeTruthy())

    // The timed task carries its time in its accessible name…
    const timed = screen.getByRole('button', { name: /Evening study, at 7 pm/ })
    // …and is positioned nineteen hour-rows down.
    expect((timed.closest('[style*="top"]') as HTMLElement | null)?.style.top).toBe('836px')

    expect(screen.getByRole('button', { name: /Anytime thing, all day/ })).toBeTruthy()
  })

  it('shows seven day columns in week view', async () => {
    mount()
    await grid()
    fireEvent.click(screen.getByRole('button', { name: /^Week/ }))

    await waitFor(() => expect(screen.getByText('31 Aug – 6 Sep 2026')).toBeTruthy())
    // One "Select …" header per day, in both the grid and the stacked fallback.
    const headers = screen.getAllByRole('button', { name: /^Select \w+day, / })
    expect(headers.length).toBeGreaterThanOrEqual(7)
  })

  it('marks today with aria-current, not only with colour', async () => {
    mount()
    await grid()
    fireEvent.click(screen.getByRole('button', { name: /^Day/ }))

    await waitFor(() => expect(screen.getByText('Thursday, 3 Sep 2026')).toBeTruthy())
    const header = screen.getByRole('button', { name: /Select Thursday, 3 Sep 2026, today/ })
    expect(header.getAttribute('aria-current')).toBe('date')
  })

  it('steps a day at a time in day view', async () => {
    mount()
    await grid()
    fireEvent.click(screen.getByRole('button', { name: /^Day/ }))
    await waitFor(() => expect(screen.getByText('Thursday, 3 Sep 2026')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }))
    await waitFor(() => expect(screen.getByText('Friday, 4 Sep 2026')).toBeTruthy())
  })
})

describe('task interaction', () => {
  it('opens the existing task detail panel from a chip', async () => {
    await capture('Study Java today')
    mount()
    await grid()

    fireEvent.click(screen.getByRole('button', { name: /^Study Java, all day/ }))
    await waitFor(() => expect(useTaskUiStore.getState().openTaskId).not.toBeNull())
  })

  it('completes a task through the command layer, with exactly one event', async () => {
    await capture('Study Java today')
    // Compared by id rather than by position: `toArray` returns rows in
    // primary-key order, and the keys are UUIDs, so "the last row" is not "the
    // newest event".
    const before = new Set((await db.events.toArray()).map((event) => event.id))

    mount()
    await grid()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Study Java' }))

    await waitFor(async () => {
      const [task] = await db.tasks.toArray()
      expect(task?.status).toBe('done')
    })

    // `task.completed` and nothing else — no stray `task.updated` beside it.
    const added = (await db.events.toArray()).filter((event) => !before.has(event.id))
    expect(added.map((event) => event.type)).toEqual(['task.completed'])
  })

  it('leaves a completed task on its day, described as complete', async () => {
    await capture('Study Java today')
    mount()
    await grid()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Study Java' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Study Java.*completed/ })).toBeTruthy(),
    )
  })

  it('shows the project a task belongs to', async () => {
    const college = await createProject('College')
    await executeText('Study Java today', {
      source: 'ui',
      now: NOW,
      defaultProjectId: college.id,
    })

    mount()
    await grid()
    expect(screen.getByRole('button', { name: /Study Java.*in College/ })).toBeTruthy()
  })
})

describe('creating a task', () => {
  it('opens the composer pre-dated to the selected day', async () => {
    mount()
    await grid()

    fireEvent.click(screen.getByRole('button', { name: /Select Friday, 11 Sep 2026/ }))
    fireEvent.click(screen.getByRole('button', { name: 'New task' }))

    const dueDate = await screen.findByLabelText<HTMLInputElement>('Due date')
    expect(dueDate.value).toBe('2026-09-11')
  })

  it('opens the composer pre-dated and pre-timed from a slot', async () => {
    mount()
    await grid()
    fireEvent.click(screen.getByRole('button', { name: /^Day/ }))
    await waitFor(() => expect(screen.getByText('Thursday, 3 Sep 2026')).toBeTruthy())

    fireEvent.click(
      screen.getByRole('button', { name: 'Add a task on Thursday, 3 Sep 2026 at 7 pm' }),
    )

    const dueDate = await screen.findByLabelText<HTMLInputElement>('Due date')
    expect(dueDate.value).toBe('2026-09-03')
    expect(screen.getByLabelText<HTMLInputElement>('Due time').value).toBe('19:00')
  })

  it('creates the task through the existing pipeline and shows it at once', async () => {
    mount()
    await grid()
    fireEvent.click(screen.getByRole('button', { name: /^Day/ }))
    await waitFor(() => expect(screen.getByText('Thursday, 3 Sep 2026')).toBeTruthy())

    fireEvent.click(
      screen.getByRole('button', { name: 'Add a task on Thursday, 3 Sep 2026 at 7 pm' }),
    )
    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Study Java' } })
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))

    await waitFor(async () => {
      const [task] = await db.tasks.toArray()
      expect(task).toMatchObject({
        title: 'Study Java',
        dueDate: '2026-09-03',
        dueTime: '19:00',
      })
    })
  })

  it('parses quick-add text exactly as every other screen does', async () => {
    mount()
    await grid()

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
  })

  it('does not date a bare quick-add just because a day is selected', async () => {
    mount()
    await grid()
    fireEvent.click(screen.getByRole('button', { name: /Select Friday, 11 Sep 2026/ }))

    const input = screen.getByLabelText('Quick add a task')
    fireEvent.change(input, { target: { value: 'Someday thing' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Bare text means the same thing here as in the Inbox: no date. The
    // selected day pre-fills the *composer*, never the parser.
    await waitFor(async () => {
      const [task] = await db.tasks.toArray()
      expect(task?.dueDate).toBeNull()
    })
  })
})

describe('unscheduled tasks', () => {
  it('lists undated work beside the grid, never on it', async () => {
    await capture('Someday thing')
    mount()
    await grid()

    const panel = screen.getByRole('region', { name: 'Unscheduled' })
    expect(within(panel).getByRole('button', { name: /^Someday thing,/ })).toBeTruthy()

    // And it is on no cell.
    const cells = screen.getAllByRole('gridcell')
    for (const cell of cells) {
      expect(within(cell).queryByRole('button', { name: /^Someday thing,/ })).toBeNull()
    }
  })

  it('says so when everything has a date', async () => {
    await capture('Study Java today')
    mount()
    await grid()

    const panel = screen.getByRole('region', { name: 'Unscheduled' })
    expect(within(panel).getByText('Everything has a date.')).toBeTruthy()
  })
})

describe('filters', () => {
  it('hides and restores completed tasks through the M3 status filter', async () => {
    await capture('Study Java today')
    await capture('Read a chapter today')
    await capture('/done Study Java')

    mount()
    await grid()
    expect(screen.getByRole('button', { name: /Study Java.*completed/ })).toBeTruthy()

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'todo' } })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Study Java,/ })).toBeNull(),
    )
    expect(screen.getByRole('button', { name: /^Read a chapter,/ })).toBeTruthy()

    fireEvent.change(screen.getByDisplayValue('To do'), { target: { value: 'done' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^Study Java,/ })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^Read a chapter,/ })).toBeNull()
  })
})

describe('keyboard', () => {
  it('moves the selected day with the arrow keys', async () => {
    mount()
    await grid()
    await waitFor(() => expect(useCalendarUiStore.getState().anchor).toBe(TODAY))

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(useCalendarUiStore.getState().selectedDate).toBe('2026-09-04')

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(useCalendarUiStore.getState().selectedDate).toBe('2026-09-02')

    // A week at a time, vertically, in a month grid.
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(useCalendarUiStore.getState().selectedDate).toBe('2026-09-09')
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(useCalendarUiStore.getState().selectedDate).toBe('2026-09-02')
  })

  it('pages the period with the bracket keys', async () => {
    mount()
    await grid()

    fireEvent.keyDown(window, { key: ']' })
    await waitFor(() => expect(screen.getByText('October 2026')).toBeTruthy())

    fireEvent.keyDown(window, { key: '[' })
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy())
  })

  it('switches views with shifted keys', async () => {
    mount()
    await grid()

    fireEvent.keyDown(window, { key: 'W' })
    await waitFor(() => expect(useCalendarUiStore.getState().mode).toBe('week'))

    fireEvent.keyDown(window, { key: 'D' })
    await waitFor(() => expect(useCalendarUiStore.getState().mode).toBe('day'))

    fireEvent.keyDown(window, { key: 'M' })
    await waitFor(() => expect(useCalendarUiStore.getState().mode).toBe('month'))
  })

  it('returns to today with Home', async () => {
    mount()
    await grid()
    await waitFor(() => expect(useCalendarUiStore.getState().anchor).toBe(TODAY))

    fireEvent.keyDown(window, { key: ']' })
    await waitFor(() => expect(useCalendarUiStore.getState().anchor).toBe('2026-10-03'))

    fireEvent.keyDown(window, { key: 'Home' })
    await waitFor(() => expect(useCalendarUiStore.getState().selectedDate).toBe(TODAY))
  })

  it('leaves shift+T to the global layer, which owns lowercase t', async () => {
    mount()
    await grid()
    await waitFor(() => expect(useCalendarUiStore.getState().anchor).toBe(TODAY))

    fireEvent.keyDown(window, { key: ']' })
    await waitFor(() => expect(useCalendarUiStore.getState().anchor).toBe('2026-10-03'))

    // The global layer lowercases before matching, so binding "T" here would
    // fight `t` → the Today task view. The calendar deliberately does not.
    fireEvent.keyDown(window, { key: 'T', shiftKey: true })
    expect(useCalendarUiStore.getState().anchor).toBe('2026-10-03')
  })

  it('opens the selected day with Enter', async () => {
    mount()
    await grid()
    await waitFor(() => expect(useCalendarUiStore.getState().anchor).toBe(TODAY))

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'Enter' })

    await waitFor(() => expect(useCalendarUiStore.getState().mode).toBe('day'))
    expect(useCalendarUiStore.getState().selectedDate).toBe('2026-09-04')
  })

  it('fires nothing while typing in quick add', async () => {
    mount()
    await grid()
    await waitFor(() => expect(useCalendarUiStore.getState().anchor).toBe(TODAY))

    const input = screen.getByLabelText('Quick add a task')
    fireEvent.change(input, { target: { value: 'MWDT[] a note' } })
    for (const key of ['M', 'W', 'D', 'Home', '[', ']', 'ArrowLeft', 'ArrowRight', 'Enter']) {
      fireEvent.keyDown(input, { key })
    }

    expect(useCalendarUiStore.getState().mode).toBe('month')
    // Nothing moved: no view switch, no paging, no day selection.
    expect(useCalendarUiStore.getState().selectedDate).toBeNull()
    expect(useCalendarUiStore.getState().anchor).toBe(TODAY)
    expect((input as HTMLInputElement).value).toBe('MWDT[] a note')
  })
})

describe('events', () => {
  it('writes nothing for viewing, switching, selecting or opening', async () => {
    await capture('Study Java today')
    const before = await db.events.count()

    mount()
    await grid()

    fireEvent.click(screen.getByRole('button', { name: /^Week/ }))
    await waitFor(() => expect(screen.getByText('31 Aug – 6 Sep 2026')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.click(screen.getAllByRole('button', { name: /^Study Java,/ })[0]!)

    await waitFor(() => expect(useTaskUiStore.getState().openTaskId).not.toBeNull())
    expect(await db.events.count()).toBe(before)
  })
})
