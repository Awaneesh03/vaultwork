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

    // Night keeps the evening composition but says night: at 22:15 the
    // header once read "Evening Wrap-Up" beside a night greeting.
    await waitFor(() => expect(screen.getByText('Good night.')).toBeTruthy())
    expect(screen.getByText('Night Wind-Down')).toBeTruthy()
    expect(screen.getByText('Time to rest. Tomorrow is lined up below.')).toBeTruthy()
    expect(screen.queryByText('Evening Wrap-Up')).toBeNull()
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

  it('10. the evening frame treatment belongs to the evening, and leaves with it', async () => {
    // The warm sidebar, canvas glow and card tint all hang off one attribute on
    // <html>. It must be absent by day, present after dark, and gone the moment
    // the Dashboard unmounts — otherwise every other screen inherits dusk.
    freezeClock(AFTERNOON_CLOCK)
    const afternoon = mountAt('/')
    await waitFor(() => expect(screen.getByText('Good afternoon.')).toBeTruthy())
    expect(document.documentElement.dataset['evening']).toBeUndefined()
    afternoon.unmount()

    freezeClock(EVENING_CLOCK)
    const evening = mountAt('/')
    await waitFor(() => expect(screen.getByText('Good evening.')).toBeTruthy())
    expect(document.documentElement.dataset['evening']).toBe('true')
    evening.unmount()
    expect(document.documentElement.dataset['evening']).toBeUndefined()

    // Night inherits the evening composition, and its frame with it.
    freezeClock(NIGHT_CLOCK)
    const night = mountAt('/')
    await waitFor(() => expect(screen.getByText('Good night.')).toBeTruthy())
    expect(document.documentElement.dataset['evening']).toBe('true')
    night.unmount()
    expect(document.documentElement.dataset['evening']).toBeUndefined()
  })

  it('9. internal test parameter previewTime=evening works without rendering any UI control', async () => {
    mountAt('/?previewTime=evening')
    await waitFor(() => expect(screen.getByText('Good evening.')).toBeTruthy())
    expect(screen.getByText('Completed Today')).toBeTruthy()
    expect(screen.queryByTestId('dashboard-preview-control')).toBeNull()
  })
})

describe('the dashboard at each boundary', () => {
  it.each([
    { at: [20, 59], greeting: 'Good evening.', eyebrow: 'Evening Wrap-Up' },
    { at: [21, 0], greeting: 'Good night.', eyebrow: 'Night Wind-Down' },
    { at: [0, 0], greeting: 'Good night.', eyebrow: 'Night Wind-Down' },
    { at: [4, 59], greeting: 'Good night.', eyebrow: 'Night Wind-Down' },
    { at: [5, 0], greeting: 'Good morning.', eyebrow: 'Daily Briefing' },
  ])('$at.0:$at.1 shows "$greeting" under "$eyebrow"', async ({ at, greeting, eyebrow }) => {
    freezeClock(new Date(2026, 8, 3, at[0], at[1], 0))
    mountAt('/')

    await waitFor(() => expect(screen.getByText(greeting)).toBeTruthy())
    expect(screen.getByText(eyebrow)).toBeTruthy()
  })

  it('ignores an invalid preview and shows the real clock', async () => {
    freezeClock(new Date(2026, 8, 3, 22, 2, 0))
    mountAt('/?previewTime=constructor')

    await waitFor(() => expect(screen.getByText('Good night.')).toBeTruthy())
    expect(screen.getByText('Night Wind-Down')).toBeTruthy()
  })
})

describe('a dashboard left open overnight', () => {
  it('moves to the new day on resume, without any database write', async () => {
    freezeClock(new Date(2026, 8, 3, 23, 58, 0))
    const view = mountAt('/')
    await waitFor(() =>
      expect(view.container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-03'),
    )

    // The Mac slept through midnight; the window regains focus.
    freezeClock(new Date(2026, 8, 4, 7, 30, 0))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() =>
      expect(view.container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-04'),
    )
    expect(screen.getByText('Good morning.')).toBeTruthy()
  })
})
