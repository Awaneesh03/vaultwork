import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { addDays } from '@/lib/date'
import { archiveHabit, completeHabit, createHabit } from '@/services'
import { useHabitUiStore } from '@/store/habitUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { HabitsView } from './HabitsView'

/**
 * The Habits screen, mounted against a real database.
 *
 * `habitService.test.ts` proves the rules with no React; this proves the screen
 * is wired to them — that ticking a habit writes exactly one row through the
 * command layer, that archiving keeps history, and that nothing here creates a
 * record for a day that has not happened.
 */

// Thursday 3 September 2026.
const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useHabitUiStore.getState().reset()
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/habits']}>
      <HabitsView />
    </MemoryRouter>,
  )

const newHabitButton = () => screen.getAllByRole('button', { name: 'New habit' })[0]!

describe('the list', () => {
  it('shows a skeleton, then the habits', async () => {
    await createHabit('Read 20 pages')
    const { container } = mount()
    // A placeholder is on screen rather than an empty panel. `DataView`'s own
    // test covers the accessible half; this one only needs the shape.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Read 20 pages' })).toBeTruthy())
  })

  it('states the schedule of each habit in words', async () => {
    await createHabit('Read')
    await createHabit('Exercise', { daysOfWeek: [1, 2, 3, 4, 5] })
    await createHabit('Long run', { cadence: 'weekly', targetPerWeek: 3 })

    const { container } = mount()
    // Wait for a real row: "Every day" also appears as a filter <option>, so
    // waiting on that text resolves before the list has drawn.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Long run' })).toBeTruthy())

    const badges = [...container.querySelectorAll('[data-habit-id]')].map(
      (row) => row.textContent ?? '',
    )
    expect(badges.some((text) => text.includes('Every day'))).toBe(true)
    expect(badges.some((text) => text.includes('Weekdays'))).toBe(true)
    expect(badges.some((text) => text.includes('3× per week'))).toBe(true)
  })

  it('offers a checkbox whose state is announced, not merely coloured', async () => {
    await createHabit('Read')
    mount()

    const box = await screen.findByRole('checkbox', { name: 'Complete Read for today' })
    expect(box.getAttribute('aria-checked')).toBe('false')
  })

  it('disables and explains the control on a day the habit is not due', async () => {
    // 3 September 2026 is a Thursday, so a weekend habit is not due.
    await createHabit('Long walk', { daysOfWeek: [0, 6] })
    mount()

    const box = await screen.findByRole('checkbox', {
      name: 'Long walk is not scheduled today',
    })
    expect(box).toHaveProperty('disabled', true)
    expect(screen.getByText('Not today')).toBeTruthy()
  })

  it('shows an empty state with a way to start', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No habits yet')).toBeTruthy())
    expect(screen.getAllByRole('button', { name: 'New habit' })).toHaveLength(2)
  })
})

describe('creating a habit', () => {
  it('writes one row and no entries at all', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No habits yet')).toBeTruthy())

    fireEvent.click(newHabitButton())
    const dialog = await screen.findByRole('dialog', { name: 'New habit' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Read' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create habit' }))

    await waitFor(async () => expect(await db.habits.count()).toBe(1))
    // The whole point of M7: a daily habit is one row, not a year of them.
    expect(await db.habitEntries.count()).toBe(0)
  })

  it('stores a weekdays schedule', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No habits yet')).toBeTruthy())

    fireEvent.click(newHabitButton())
    const dialog = await screen.findByRole('dialog', { name: 'New habit' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Exercise' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekdays' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create habit' }))

    await waitFor(async () => {
      const [habit] = await db.habits.toArray()
      expect(habit?.daysOfWeek).toEqual([1, 2, 3, 4, 5])
      expect(habit?.cadence).toBe('daily')
    })
  })

  it('stores a custom day set', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No habits yet')).toBeTruthy())

    fireEvent.click(newHabitButton())
    const dialog = await screen.findByRole('dialog', { name: 'New habit' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Custom days' }))
    // Defaults to Mon/Wed/Fri; drop Wednesday.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wednesday' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create habit' }))

    await waitFor(async () => {
      const [habit] = await db.habits.toArray()
      expect(habit?.daysOfWeek).toEqual([1, 5])
    })
  })

  it('stores a weekly target and no days', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No habits yet')).toBeTruthy())

    fireEvent.click(newHabitButton())
    const dialog = await screen.findByRole('dialog', { name: 'New habit' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Long run' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Times per week' }))
    fireEvent.change(within(dialog).getByLabelText('Times per week'), { target: { value: '2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create habit' }))

    await waitFor(async () => {
      const [habit] = await db.habits.toArray()
      expect(habit).toMatchObject({ cadence: 'weekly', targetPerWeek: 2, daysOfWeek: [] })
    })
  })

  it('refuses a blank name without writing anything', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No habits yet')).toBeTruthy())

    fireEvent.click(newHabitButton())
    const dialog = await screen.findByRole('dialog', { name: 'New habit' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create habit' }))

    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'A habit needs a name',
    )
    expect(await db.habits.count()).toBe(0)
  })
})

describe('completing', () => {
  it('records exactly one entry for today', async () => {
    await createHabit('Read')
    mount()

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Read for today' }))

    await waitFor(async () => expect(await db.habitEntries.count()).toBe(1))
    const [entry] = await db.habitEntries.toArray()
    expect(entry).toMatchObject({ date: TODAY, value: 1 })
  })

  it('flips the announced state of the control', async () => {
    await createHabit('Read')
    mount()

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Read for today' }))
    const box = await screen.findByRole('checkbox', { name: 'Undo Read for today' })
    expect(box.getAttribute('aria-checked')).toBe('true')
  })

  it('is idempotent: clicking twice leaves one row and one event', async () => {
    await createHabit('Read')
    mount()

    const box = await screen.findByRole('checkbox', { name: 'Complete Read for today' })
    fireEvent.click(box)
    await waitFor(async () => expect(await db.habitEntries.count()).toBe(1))

    // The control is now "Undo", so a second *complete* has to come from the
    // command layer rather than a second click on a toggled checkbox.
    await completeHabit((await db.habits.toArray())[0]!.id)
    expect(await db.habitEntries.count()).toBe(1)

    const events = await db.events.toArray()
    expect(events.filter((event) => event.type === 'habit.completed')).toHaveLength(1)
  })

  it('undoes today and removes the row', async () => {
    await createHabit('Read')
    mount()

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Read for today' }))
    await screen.findByRole('checkbox', { name: 'Undo Read for today' })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Undo Read for today' }))
    await waitFor(async () => expect(await db.habitEntries.count()).toBe(0))
    await screen.findByRole('checkbox', { name: 'Complete Read for today' })
  })

  it('moves the streak and today counter immediately', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id, { date: addDays(TODAY, -1) })
    mount()

    await waitFor(() => expect(screen.getByLabelText('Current streak 1')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Read for today' }))

    await waitFor(() => expect(screen.getByLabelText('Current streak 2')).toBeTruthy())
    expect(screen.getByLabelText('1 of 1 habits complete today')).toBeTruthy()
  })
})

describe('history', () => {
  it('marks done, missed and never-scheduled days differently', async () => {
    const habit = await createHabit('Exercise', { daysOfWeek: [1, 2, 3, 4, 5] })
    await completeHabit(habit.id, { date: TODAY })

    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Exercise' }))

    const panel = await screen.findByRole('dialog', { name: 'Exercise details' })
    // Thursday done; the preceding Saturday was never owed.
    expect(within(panel).getByLabelText(/Thursday, 3 Sep 2026, completed/)).toBeTruthy()
    expect(within(panel).getByLabelText(/Saturday, 29 Aug 2026, not scheduled/)).toBeTruthy()
    expect(within(panel).getByLabelText(/Wednesday, 2 Sep 2026, missed/)).toBeTruthy()
  })

  it('closes the detail panel with Escape, without tabbing into it first', async () => {
    await createHabit('Read')
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Read' }))

    const panel = await screen.findByRole('dialog', { name: 'Read details' })
    // The panel focuses itself on open, so Escape reaches its handler.
    expect(document.activeElement).toBe(panel)

    fireEvent.keyDown(panel, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Read details' })).toBeNull())
  })

  it('shows streaks, best and rate in the detail panel', async () => {
    const habit = await createHabit('Read')
    for (const offset of [-2, -1, 0]) {
      await completeHabit(habit.id, { date: addDays(TODAY, offset) })
    }

    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Read' }))

    const panel = await screen.findByRole('dialog', { name: 'Read details' })
    expect(within(panel).getByText('Streak').nextSibling?.textContent).toBe('3')
    expect(within(panel).getByText('Best').nextSibling?.textContent).toBe('3')
    expect(within(panel).getByText('Recent completions')).toBeTruthy()
  })
})

describe('archive and delete', () => {
  it('archives from the row, keeping every entry', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Read' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Archive Read' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Read' })).toBeNull())
    expect((await db.habits.toArray())[0]?.archivedAt).not.toBeNull()
    // The history is untouched.
    expect(await db.habitEntries.count()).toBe(1)
  })

  it('finds it under Archived and restores it', async () => {
    const habit = await createHabit('Read')
    await archiveHabit(habit.id)

    mount()
    await waitFor(() => expect(screen.getByText('No habits yet')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Archived/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Read' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Restore Read' }))

    await waitFor(async () => expect((await db.habits.toArray())[0]?.archivedAt).toBeNull())
  })

  it('deletes without a dialog and keeps the history', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Read' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Delete Read' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Read' })).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useToastStore.getState().undoStack[0]).toMatchObject({ kind: 'habit.restore' })

    // Soft-deleted, and its record of what happened is still there.
    expect((await db.habits.toArray())[0]?.deletedAt).toBeGreaterThan(0)
    expect(await db.habitEntries.count()).toBe(1)
  })
})

describe('editing', () => {
  it('changes the schedule without touching a single entry', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id, { date: addDays(TODAY, -1) })
    await completeHabit(habit.id)
    const before = await db.habitEntries.toArray()

    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Read' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Read' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit Read' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekdays' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save habit' }))

    await waitFor(async () => {
      expect((await db.habits.toArray())[0]?.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    })
    // History is what happened; the schedule is what is intended now.
    expect(await db.habitEntries.toArray()).toEqual(before)
  })

  it('keeps the id when renaming', async () => {
    const habit = await createHabit('Read')
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Read' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Edit Read' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Read' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Read more' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save habit' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Read more' })).toBeTruthy())
    const rows = await db.habits.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(habit.id)
  })
})

describe('search and filters', () => {
  beforeEach(async () => {
    const read = await createHabit('Read 20 pages')
    await createHabit('Exercise', { daysOfWeek: [1, 2, 3, 4, 5] })
    await completeHabit(read.id)
  })

  it('filters by name', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exercise' })).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Search habits'), { target: { value: 'read' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Exercise' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Read 20 pages' })).toBeTruthy()
  })

  it('filters by the status of today', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exercise' })).toBeTruthy())

    fireEvent.change(screen.getByDisplayValue('Any status'), { target: { value: 'todo' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Read 20 pages' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Exercise' })).toBeTruthy()
  })

  it('filters by frequency', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exercise' })).toBeTruthy())

    fireEvent.change(screen.getByDisplayValue('Any frequency'), { target: { value: 'weekdays' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Read 20 pages' })).toBeNull())
  })
})

describe('keyboard', () => {
  it('moves, toggles and opens from the keyboard', async () => {
    await createHabit('Read')
    await createHabit('Exercise')
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exercise' })).toBeTruthy())

    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: ' ' })
    await waitFor(async () => expect(await db.habitEntries.count()).toBe(1))

    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('dialog', { name: /details/ })).toBeTruthy())
  })

  it('does not fire a shortcut while typing in a habit name', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No habits yet')).toBeTruthy())

    fireEvent.click(newHabitButton())
    const dialog = await screen.findByRole('dialog', { name: 'New habit' })
    const name = within(dialog).getByLabelText('Name')

    fireEvent.change(name, { target: { value: 'Jaunt' } })
    for (const key of ['j', 'k', 'e', 'A', ' ', 'Enter', '#', 'Backspace']) {
      fireEvent.keyDown(name, { key })
    }

    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe('Jaunt')
    expect(useHabitUiStore.getState().selectedHabitId).toBeNull()
    expect(await db.habits.count()).toBe(0)
  })

  it('does not act on the list while typing in the search box', async () => {
    const habit = await createHabit('Read')
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Read' })).toBeTruthy())

    const search = screen.getByLabelText('Search habits')
    for (const key of ['A', 'e', ' ', '#', 'Backspace']) fireEvent.keyDown(search, { key })

    const row = await db.habits.get(habit.id)
    expect(row?.archivedAt).toBeNull()
    expect(row?.deletedAt).toBeNull()
    expect(await db.habitEntries.count()).toBe(0)
  })
})

describe('reordering', () => {
  it('gives each active row a keyboard-reachable grip', async () => {
    await createHabit('Read')
    await createHabit('Exercise')
    mount()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reorder Read' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Reorder Exercise' })).toBeTruthy()
  })
})

describe('events', () => {
  it('writes nothing for opening a habit or reading its history', async () => {
    await createHabit('Read')
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Read' })).toBeTruthy())

    const before = await db.events.count()
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))
    await screen.findByRole('dialog', { name: 'Read details' })

    expect(await db.events.count()).toBe(before)
  })
})
