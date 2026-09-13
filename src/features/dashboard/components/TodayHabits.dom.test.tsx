import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { archiveHabit, completeHabit, createHabit, executeText } from '@/services'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { DashboardView } from '../views/DashboardView'

/**
 * The Dashboard's habit section, mounted against a real database.
 *
 * It must agree with the Habits screen because it calls the same query, and it
 * must stay in its own section — a habit is never an answer to "what task
 * should I work on next".
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useTaskUiStore.getState().resetForView()
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <DashboardView />
    </MemoryRouter>,
  )

const card = () => screen.findByRole('region', { name: "Today's habits" })

describe("today's habits on the dashboard", () => {
  it('lists the habits due today with a completed count', async () => {
    const read = await createHabit('Read 20 pages')
    await createHabit('Meditate')
    await completeHabit(read.id)

    mount()
    const region = await card()

    await waitFor(() =>
      expect(within(region).getByLabelText('1 of 2 habits complete today')).toBeTruthy(),
    )
    expect(within(region).getByText('Read 20 pages')).toBeTruthy()
    expect(within(region).getByText('Meditate')).toBeTruthy()
  })

  it('excludes habits not scheduled today', async () => {
    await createHabit('Meditate')
    // Thursday, so a weekend habit is not owed.
    await createHabit('Long walk', { daysOfWeek: [0, 6] })

    mount()
    const region = await card()
    await waitFor(() => expect(within(region).getByText('Meditate')).toBeTruthy())
    expect(within(region).queryByText('Long walk')).toBeNull()
  })

  it('excludes archived habits', async () => {
    await createHabit('Meditate')
    const old = await createHabit('Old habit')
    await archiveHabit(old.id)

    mount()
    const region = await card()
    await waitFor(() => expect(within(region).getByText('Meditate')).toBeTruthy())
    expect(within(region).queryByText('Old habit')).toBeNull()
  })

  it('completes a habit in place and updates the count at once', async () => {
    await createHabit('Read')
    await createHabit('Meditate')

    mount()
    const region = await card()
    await waitFor(() =>
      expect(within(region).getByLabelText('0 of 2 habits complete today')).toBeTruthy(),
    )

    fireEvent.click(within(region).getByRole('checkbox', { name: 'Complete Read for today' }))

    await waitFor(() =>
      expect(within(region).getByLabelText('1 of 2 habits complete today')).toBeTruthy(),
    )
    expect(await db.habitEntries.count()).toBe(1)
  })

  it('shows an empty state when nothing is due', async () => {
    await createHabit('Long walk', { daysOfWeek: [0, 6] })
    mount()

    const region = await card()
    await waitFor(() => expect(within(region).getByText('No habits scheduled today.')).toBeTruthy())
  })

  it('keeps the task Next Action task-only', async () => {
    await createHabit('Drink water')
    await executeText('Study Java today', { source: 'ui', now: NOW })

    mount()
    const next = await screen.findByRole('region', { name: 'Next action' })

    await waitFor(() => expect(within(next).getByText('Study Java')).toBeTruthy())
    // A habit must never be offered as the next *task*.
    expect(within(next).queryByText('Drink water')).toBeNull()
  })

  it('leaves Next Action clear when only habits exist', async () => {
    await createHabit('Drink water')
    mount()

    const next = await screen.findByRole('region', { name: 'Next action' })
    await waitFor(() => expect(within(next).getByText(/You’re clear/)).toBeTruthy())
  })
})
