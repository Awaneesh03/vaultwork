import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { getSettings } from '@/services'
import { resetDatabase, freezeClock } from '../../../../tests/helpers'
import { SettingsView } from './SettingsView'

/**
 * Settings as a set of decisions rather than a form dump.
 *
 * `SettingsDesktop.dom.test.tsx` proves the desktop-facing behaviours — the
 * notification test reports what happened, the native File menu presses the
 * same controls a mouse would. This proves what the redesign added: that the
 * preferences the rest of the application already reads are now reachable, and
 * that the one control which destroys data is no longer a plain button beside
 * two safe ones.
 */

const NOW = new Date(2026, 8, 7, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const app = () =>
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsView />
    </MemoryRouter>,
  )

describe('preferences the rest of the app already reads', () => {
  it('lets the week start be changed at all', async () => {
    app()
    // Habit streaks have read `weekStartsOn` since Habits was built, with no
    // control anywhere in the product to change it.
    const group = await screen.findByRole('group', { name: 'Week starts on' })
    expect(within(group).getByRole('button', { name: 'Monday' })).toBeTruthy()

    fireEvent.click(within(group).getByRole('button', { name: 'Sunday' }))

    await waitFor(async () => expect((await getSettings()).weekStartsOn).toBe(0))
  })

  it('marks the current choice for a reader who cannot see the fill', async () => {
    app()
    const group = await screen.findByRole('group', { name: 'Week starts on' })
    const monday = within(group).getByRole('button', { name: 'Monday' })
    const sunday = within(group).getByRole('button', { name: 'Sunday' })

    expect(monday.getAttribute('aria-pressed')).toBe('true')
    expect(sunday.getAttribute('aria-pressed')).toBe('false')
  })

  it('changes the focus session length the Focus screen offers', async () => {
    app()
    const work = (await screen.findByLabelText('Work')) as HTMLInputElement
    expect(work.value).toBe('25')

    fireEvent.change(work, { target: { value: '50' } })

    await waitFor(async () => expect((await getSettings()).pomodoro.workMin).toBe(50))
  })

  it('refuses a length that would make the timer meaningless', async () => {
    app()
    const work = await screen.findByLabelText('Work')

    fireEvent.change(work, { target: { value: '0' } })

    // Clamped rather than stored: a zero-minute pomodoro is not a preference.
    await waitFor(async () => expect((await getSettings()).pomodoro.workMin).toBe(1))
  })

  it('changes the daily goal the dashboard measures against', async () => {
    app()
    const goal = await screen.findByLabelText('Tasks a day')

    fireEvent.change(goal, { target: { value: '7' } })

    await waitFor(async () => expect((await getSettings()).dailyTaskGoal).toBe(7))
  })
})

describe('the one control that destroys data', () => {
  const backup = () =>
    new File(
      [JSON.stringify({ schemaVersion: 1, exportedAt: NOW.getTime(), data: {} })],
      'b.json',
      {
        type: 'application/json',
      },
    )

  it('asks before replacing everything, and says that is what it does', async () => {
    app()
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(picker, { target: { files: [backup()] } })

    const gate = await screen.findByRole('group', { name: 'Confirm import' })
    // "Import" sounds additive. It is not: it calls replaceAll.
    expect(within(gate).getByText(/does not merge/)).toBeTruthy()
    expect(within(gate).getByText(/b\.json/)).toBeTruthy()
    expect(within(gate).getByRole('button', { name: 'Replace my data' })).toBeTruthy()
  })

  it('writes nothing while the question is still on screen', async () => {
    await db.tasks.add({
      id: 'keep-me',
      title: 'Still here',
      status: 'todo',
      priority: 'normal',
      createdAt: NOW.getTime(),
      updatedAt: NOW.getTime(),
      deletedAt: null,
    } as never)

    app()
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(picker, { target: { files: [backup()] } })
    await screen.findByRole('group', { name: 'Confirm import' })

    expect(await db.tasks.get('keep-me')).toBeDefined()
  })

  it('backs out without touching anything', async () => {
    app()
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(picker, { target: { files: [backup()] } })

    const gate = await screen.findByRole('group', { name: 'Confirm import' })
    fireEvent.click(within(gate).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('group', { name: 'Confirm import' })).toBeNull())
  })
})

describe('grouping', () => {
  it('keeps the groups people actually look for', async () => {
    app()
    for (const group of [
      'Appearance',
      'Productivity',
      'Assistant',
      'Telegram',
      'Desktop',
      'Storage',
      'About',
    ]) {
      expect(await screen.findByRole('heading', { name: group })).toBeTruthy()
    }
  })
})
