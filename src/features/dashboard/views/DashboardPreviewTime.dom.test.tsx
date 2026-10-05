import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeText } from '@/services'
import { useProjectUiStore } from '@/store/projectUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { DashboardView } from './DashboardView'

// Pinned reference dates across time-of-day boundaries
const MORNING_CLOCK = new Date(2026, 8, 3, 10, 0, 0) // 10:00 AM -> Morning
const AFTERNOON_CLOCK = new Date(2026, 8, 3, 14, 30, 0) // 2:30 PM -> Afternoon
const EVENING_CLOCK = new Date(2026, 8, 3, 18, 0, 0) // 6:00 PM -> Evening
const NIGHT_CLOCK = new Date(2026, 8, 3, 22, 15, 0) // 10:15 PM -> Night

beforeEach(async () => {
  await resetDatabase()
  freezeClock(MORNING_CLOCK)
  useTaskUiStore.getState().resetForView()
  useTaskUiStore.setState({ quickAddOpen: false })
  useProjectUiStore.getState().resetForView()
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const mountAt = (initialEntry: string = '/') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<DashboardView />} />
        <Route path="/dashboard" element={<DashboardView />} />
      </Routes>
    </MemoryRouter>,
  )

describe('Automatic Dashboard Time of Day & Composition', () => {
  it('1. morning clock automatically displays morning greeting & plan composition', async () => {
    freezeClock(MORNING_CLOCK)
    mountAt('/')

    await waitFor(() => expect(screen.getByText('Good morning.')).toBeTruthy())
    expect(screen.getByText('Daily Briefing')).toBeTruthy()
    // Evening reflection & Still Open unified panel are not in morning plan view
    expect(screen.queryByText('Evening Reflection')).toBeNull()
    expect(screen.queryByLabelText('Still open work')).toBeNull()
  })

  it('2. afternoon clock automatically displays afternoon greeting & execute composition', async () => {
    freezeClock(AFTERNOON_CLOCK)
    mountAt('/')

    await waitFor(() => expect(screen.getByText('Good afternoon.')).toBeTruthy())
    expect(screen.getByText('Daily Briefing')).toBeTruthy()
    expect(screen.queryByText('Evening Reflection')).toBeNull()
  })

  it('3. evening clock automatically displays Evening Command Center composition', async () => {
    freezeClock(EVENING_CLOCK)
    await executeText('Buy groceries today', { source: 'ui', now: EVENING_CLOCK })

    mountAt('/')

    await waitFor(() => expect(screen.getByText('Good evening.')).toBeTruthy())
    expect(screen.getByText('Evening Wrap-Up')).toBeTruthy()
    expect(screen.getByText('Great progress today. Let’s wrap things up.')).toBeTruthy()

    // Evening Command Center composition elements:
    expect(screen.getByText('Completed Today')).toBeTruthy()
    expect(screen.getByLabelText('Still open work')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tomorrow' })).toBeTruthy()
    expect(screen.getByText('Evening Reflection')).toBeTruthy()
    expect(screen.getByText('Wind Down')).toBeTruthy()
  })

  it('4. night clock automatically displays night greeting & calm wrap-up composition', async () => {
    freezeClock(NIGHT_CLOCK)
    mountAt('/')

    await waitFor(() => expect(screen.getByText('Still up.')).toBeTruthy())
    expect(screen.getByText('Evening Wrap-Up')).toBeTruthy()
    expect(screen.getByText('Completed Today')).toBeTruthy()
    expect(screen.getByText('Evening Reflection')).toBeTruthy()
  })

  it('5. NO visible preview toolbar exists in normal development UI', async () => {
    mountAt('/')
    await waitFor(() => expect(screen.getByText('Good morning.')).toBeTruthy())

    // No visible toolbar or preview buttons
    expect(screen.queryByTestId('dashboard-preview-control')).toBeNull()
    expect(screen.queryByRole('button', { name: 'System' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Morning' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Afternoon' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Evening' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Night' })).toBeNull()
  })

  it('6. NO visible preview toolbar exists in production builds', async () => {
    vi.stubEnv('DEV', false)
    try {
      mountAt('/')
      await waitFor(() => expect(screen.getByText('Good morning.')).toBeTruthy())
      expect(screen.queryByTestId('dashboard-preview-control')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Evening' })).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('7. recalculates and transitions immediately after application resume / focus', async () => {
    // Mount in afternoon at 4:00 PM
    const fourPm = new Date(2026, 8, 3, 16, 0, 0)
    freezeClock(fourPm)
    mountAt('/')

    await waitFor(() => expect(screen.getByText('Good afternoon.')).toBeTruthy())
    expect(screen.queryByText('Evening Reflection')).toBeNull()

    // User sleeps laptop, resumes at 6:00 PM (Evening)
    freezeClock(EVENING_CLOCK)

    // Fire window focus / visibility change event as happens upon app wake
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    // Dashboard automatically switches to Evening without page reload
    await waitFor(() => expect(screen.getByText('Good evening.')).toBeTruthy())
    expect(screen.getByText('Evening Wrap-Up')).toBeTruthy()
    expect(screen.getByText('Completed Today')).toBeTruthy()
    expect(screen.getByText('Evening Reflection')).toBeTruthy()
  })

  it('8. Evening composition is visually and structurally distinct from Daytime', async () => {
    await executeText('Urgent task today', { source: 'ui', now: MORNING_CLOCK })

    // Daytime check (Morning/Afternoon)
    freezeClock(AFTERNOON_CLOCK)
    const { unmount } = mountAt('/')

    await waitFor(() => expect(screen.getByText('Good afternoon.')).toBeTruthy())
    // Daytime contains individual Overdue & Today cards, not Still open work
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
    expect(screen.queryByLabelText('Still open work')).toBeNull()
    expect(screen.queryByText('Evening Reflection')).toBeNull()
    unmount()

    // Evening check
    freezeClock(EVENING_CLOCK)
    mountAt('/')

    await waitFor(() => expect(screen.getByText('Good evening.')).toBeTruthy())
    // Evening elevates Completed Today, unifies unfinished work in Still Open, shows Tomorrow & Reflection
    expect(screen.getByText('Completed Today')).toBeTruthy()
    expect(screen.getByLabelText('Still open work')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tomorrow' })).toBeTruthy()
    expect(screen.getByText('Evening Reflection')).toBeTruthy()
  })

  it('9. internal test parameter previewTime=evening works without rendering any UI control', async () => {
    mountAt('/?previewTime=evening')
    await waitFor(() => expect(screen.getByText('Good evening.')).toBeTruthy())
    expect(screen.getByText('Completed Today')).toBeTruthy()
    expect(screen.queryByTestId('dashboard-preview-control')).toBeNull()
  })
})
