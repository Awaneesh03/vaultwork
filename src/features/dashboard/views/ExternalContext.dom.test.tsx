import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PortNotSupportedError, platform, type CalendarPort, type EmailPort } from '@/platform'
import { executeText } from '@/services'
import { useProjectUiStore } from '@/store/projectUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { DashboardView } from './DashboardView'

/**
 * M19.1 on screen: calendar and email beside the plan, never inside it — and a
 * source that is absent, failing or hung costs its own section and nothing else.
 */

const NOW = new Date(2026, 8, 21, 10, 0, 0)
const at = (hour: number, day = 21) => new Date(2026, 8, day, hour, 0, 0).getTime()
const browser = { calendar: platform.calendar, email: platform.email }

function install<K extends 'calendar' | 'email'>(key: K, port: (typeof platform)[K]) {
  Object.defineProperty(platform, key, { value: port, configurable: true, writable: true })
}

const calendar = (eventsBetween: CalendarPort['eventsBetween']): CalendarPort => ({
  id: 'fake-calendar',
  isSupported: true,
  eventsBetween,
})
const email = (recentSignals: EmailPort['recentSignals']): EmailPort => ({
  id: 'fake-email',
  isSupported: true,
  recentSignals,
})

const events = calendar(async () => [
  {
    id: 'e1',
    title: 'Placement interview',
    start: at(15),
    end: at(16),
    allDay: false,
    status: 'confirmed',
  },
  {
    id: 'e2',
    title: 'Club meeting',
    start: at(18, 22),
    end: null,
    allDay: false,
    status: 'tentative',
  },
])
const signals = email(async () => [
  {
    id: 'm1',
    subject: 'Offer letter',
    sender: 'HR Team',
    receivedAt: at(8),
    important: true,
    snippet: 'Please review and sign',
  },
])
const failing = async (): Promise<never> => {
  throw new Error('token expired')
}
const hanging = (): Promise<never> => new Promise(() => {})

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useTaskUiStore.getState().resetForView()
  useTaskUiStore.setState({ quickAddOpen: false })
  useProjectUiStore.getState().resetForView()
  useToastStore.setState({ toasts: [], undoStack: [] })
})

afterEach(() => {
  install('calendar', browser.calendar)
  install('email', browser.email)
})

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DashboardView />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  )

const addTask = () => executeText('Study DBMS today', { source: 'ui', now: NOW })

describe('external context on Today', () => {
  it('shows nothing external when no source is connected, and says so', async () => {
    await addTask()
    mount()
    expect((await screen.findAllByText('Study DBMS')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: 'Calendar' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Important emails' })).toBeNull()
    expect(screen.queryByText('External')).toBeNull()
    expect(
      screen.getByText(/Email, external calendars and other sources are not connected\./),
    ).toBeTruthy()
  })

  it('shows calendar events, marked external, beside the tasks — not among them', async () => {
    install('calendar', events)
    await addTask()
    mount()
    const section = await screen.findByRole('region', { name: 'Calendar' })
    expect(within(section).getByText('External')).toBeTruthy()
    expect(within(section).getByText('Placement interview')).toBeTruthy()
    expect(within(section).getByText('Club meeting')).toBeTruthy()
    expect(within(section).getByText('tentative')).toBeTruthy()
    expect(within(section).queryByText('Study DBMS')).toBeNull()
    // An event is not a task: it appears once, in its own section.
    expect(screen.getAllByText('Placement interview')).toHaveLength(1)
    expect(
      screen.getByText(
        /Calendar is read live and not stored\. Email and other sources are not connected\./,
      ),
    ).toBeTruthy()
  })

  it('shows important emails with sender, subject and snippet', async () => {
    install('email', signals)
    mount()
    const section = await screen.findByRole('region', { name: 'Important emails' })
    expect(within(section).getByText('External')).toBeTruthy()
    expect(within(section).getByText('HR Team')).toBeTruthy()
    expect(within(section).getByText(/Offer letter/)).toBeTruthy()
    expect(within(section).getByText('Please review and sign')).toBeTruthy()
  })

  it('a failing calendar says so in one line; email and the tasks still show', async () => {
    install('calendar', calendar(failing))
    install('email', signals)
    await addTask()
    mount()
    expect(await screen.findByText(/Your calendar couldn.t be read just now\./)).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'Important emails' })).toBeTruthy()
    expect(screen.getAllByText('Study DBMS').length).toBeGreaterThan(0)
    expect(screen.queryByText(/token expired/)).toBeNull()
    // Failing is not the same as absent: the footer does not call it unconnected.
    expect(
      screen.getByText(
        /Built from Vaultwork alone\. Email is read live and not stored\. Other sources are not connected\./,
      ),
    ).toBeTruthy()
  })

  it('a hung email source holds up nothing — Today and the calendar render', async () => {
    install('calendar', events)
    install('email', email(hanging))
    await addTask()
    mount()
    expect(await screen.findByRole('region', { name: 'Calendar' })).toBeTruthy()
    expect(screen.getAllByText('Study DBMS').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'Next action' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Important emails' })).toBeNull()
  })

  it('a connected-but-not-granted source shows nothing and says not connected', async () => {
    install(
      'calendar',
      calendar(async () => {
        throw new PortNotSupportedError('calendar', 'eventsBetween')
      }),
    )
    install('email', signals)
    mount()
    expect(await screen.findByRole('region', { name: 'Important emails' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Calendar' })).toBeNull()
    expect(screen.queryByText(/calendar couldn.t be read/)).toBeNull()
    expect(
      screen.getByText(/Email is read live and not stored\. External calendars and other sources/),
    ).toBeTruthy()
  })

  it('checks again on request — and only then', async () => {
    let reads = 0
    install(
      'calendar',
      calendar(async () => {
        reads += 1
        return reads === 1
          ? []
          : [
              {
                id: 'e9',
                title: 'Added later',
                start: at(17),
                end: null,
                allDay: false,
                status: 'confirmed',
              },
            ]
      }),
    )
    mount()
    expect(await screen.findByText('Nothing on your calendar this week.')).toBeTruthy()
    expect(reads).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Added later')).toBeTruthy()
    expect(reads).toBe(2)
  })
})
