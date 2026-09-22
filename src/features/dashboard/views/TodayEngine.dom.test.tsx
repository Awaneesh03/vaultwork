import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { createProject, executeText } from '@/services'
import { useProjectUiStore } from '@/store/projectUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { DashboardView } from './DashboardView'

/**
 * M19 on screen: the Today Engine's additions to the Dashboard — every one of
 * them a reason, a count or an honest "not known", in words.
 */

const NOW = new Date(2026, 8, 21, 10, 0, 0)

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
        <Route path="/inbox" element={<p>inbox screen</p>} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  )

const capture = (text: string) => executeText(text, { source: 'ui', now: NOW })

describe('the Today Engine on the Dashboard', () => {
  it('says why the next action was chosen', async () => {
    await capture('Submit lab record yesterday')
    mount()
    const next = await screen.findByRole('region', { name: 'Next action' })
    expect(within(next).getByText('Why: Overdue by 1 day')).toBeTruthy()
  })

  it('shows how late each overdue task is, in words', async () => {
    await capture('Return the book mon !low')
    await capture('Submit lab record yesterday')
    mount()
    expect(await screen.findByText('1 day late')).toBeTruthy()
  })

  it('reports today so far with words beside every number', async () => {
    await capture('Study Java today ~45m')
    await capture('Write report today')
    mount()
    const today = await screen.findByRole('region', { name: 'Today so far' })
    expect(within(today).getByText('0 / 2')).toBeTruthy()
    expect(within(today).getByText('tasks done today')).toBeTruthy()
    expect(within(today).getByText('focused today')).toBeTruthy()
    expect(within(today).getByText('habits logged')).toBeTruthy()
  })

  it('gives estimated work with its coverage, and never an invented available time', async () => {
    await capture('Study Java today ~45m')
    await capture('Write report today')
    mount()
    const today = await screen.findByRole('region', { name: 'Today so far' })
    expect(within(today).getByText(/About 45m of estimated work, from 1 of 2 tasks\./)).toBeTruthy()
    expect(within(today).getByText(/can.t say whether that fits your day/)).toBeTruthy()
    expect(today.textContent).not.toMatch(/Available|available time|you have .* free/i)
  })

  it('says a clear day is clear, without pretending there is a plan', async () => {
    mount()
    const today = await screen.findByRole('region', { name: 'Today so far' })
    expect(within(today).getByText('Nothing is due today or overdue.')).toBeTruthy()
    expect(today.textContent).not.toMatch(/working hours/)
  })

  it('names an approaching project deadline on its row', async () => {
    await createProject('FixKaru', { deadline: '2026-09-22' })
    mount()
    expect(await screen.findByText('Deadline tomorrow')).toBeTruthy()
  })

  it('states which sources the day was built from', async () => {
    mount()
    expect(
      await screen.findByText(
        /Built from Vaultwork alone\. Email, external calendars and other sources are not connected\./,
      ),
    ).toBeTruthy()
  })
})
