import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platform } from '@/platform'
import { eventRepo, focusSessionRepo, settingsRepo } from '@/repositories'
import { cancelFocus, completeFocus, startFocus } from '@/services'
import { freezeClock, resetDatabase, waitOutsideAct } from '../../../../tests/helpers'
import { FocusView } from './FocusView'

/**
 * The Focus screen, mounted against a real database.
 *
 * `focusService.test.ts` proves the rules with no React. This proves the screen
 * is wired to them, and covers the failures that only exist once a timer meets
 * a component: a second session started by a second click, a countdown that
 * disagrees with the stored session after a remount, and an interval still
 * ticking after the screen has gone.
 */

// Thursday 3 September 2026, ten in the morning.
const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  /*
   * Pinned, not merely frozen. `freezeClock` advances a millisecond per read so
   * that ids and timestamps stay distinct, and a countdown rendered between two
   * of those reads can show a second more or less than the one it was started
   * with. Time moves here only when a test moves it.
   */
  setNow(NOW)
})

/** Pins the clock to an exact instant, overriding `freezeClock`'s drift. */
function setNow(at: Date): void {
  vi.spyOn(platform.clock, 'now').mockReturnValue(at.getTime())
}

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/focus']}>
      <FocusView />
    </MemoryRouter>,
  )

const timer = () => screen.getByRole('timer')

/**
 * The start button, once it is actually usable.
 *
 * It renders disabled until the live query and the pomodoro settings have both
 * arrived — clicking it before then is a no-op, which is correct behaviour and
 * a very confusing test failure.
 */
const startButton = (name: RegExp) => screen.findByRole('button', { name })
const focusEvents = async () =>
  (await eventRepo.list())
    .reverse()
    .map((event) => event.type)
    .filter((type) => type.startsWith('focus.'))

describe('starting a session', () => {
  it('offers each kind with the length it will actually run for', async () => {
    await settingsRepo.update({
      pomodoro: { workMin: 40, shortBreakMin: 7, longBreakMin: 20, cyclesBeforeLongBreak: 4 },
    })
    mount()

    // The durations come from settings, so the button cannot promise 25 minutes
    // and then run for 40.
    await waitFor(() => expect(screen.getByRole('button', { name: /Focus · 40m/ })).toBeTruthy())
    expect(screen.getByRole('button', { name: /Short break · 7m/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Long break · 20m/ })).toBeTruthy()
  })

  it('writes one session and shows the countdown', async () => {
    mount()
    const start = await startButton(/Focus · 25m/)

    fireEvent.click(start)

    await waitFor(() => expect(timer()).toBeTruthy())
    expect(timer().textContent).toBe('25:00')
    expect(await focusSessionRepo.list()).toHaveLength(1)
    expect(await focusEvents()).toEqual(['focus.started'])
  })

  it('does not start a second session when the button is clicked twice', async () => {
    mount()
    const start = await startButton(/Focus · 25m/)

    // The double-click that a real user produces, with no await in between.
    fireEvent.click(start)
    fireEvent.click(start)

    await waitFor(() => expect(timer()).toBeTruthy())
    await waitOutsideAct(async () => {
      expect(await focusSessionRepo.list()).toHaveLength(1)
    })
    expect(await focusEvents()).toEqual(['focus.started'])
  })

  it('starts the kind that was asked for', async () => {
    mount()
    fireEvent.click(await startButton(/Short break · 5m/))

    await waitFor(() => expect(timer()).toBeTruthy())
    expect(screen.getByText(/Short break · 5m/)).toBeTruthy()
  })
})

describe('a session already in the database', () => {
  it('is picked back up on mount with the right time left', async () => {
    // Started ten minutes ago, then the app was closed and reopened.
    await startFocus({ plannedMin: 25 })
    setNow(new Date(NOW.getTime() + 10 * 60_000))

    mount()

    await waitFor(() => expect(timer()).toBeTruthy())
    // Derived from the stored timestamps, not counted while the screen was gone.
    expect(timer().textContent).toBe('15:00')
  })

  it('shows the same number after a remount, because nothing is counted in state', async () => {
    await startFocus({ plannedMin: 25 })
    setNow(new Date(NOW.getTime() + 3 * 60_000))

    const first = mount()
    await waitFor(() => expect(timer().textContent).toBe('22:00'))
    first.unmount()

    mount()
    await waitFor(() => expect(timer().textContent).toBe('22:00'))
  })
})

describe('finishing', () => {
  it('records the time spent and returns to the idle screen', async () => {
    await startFocus({ plannedMin: 25 })
    mount()
    await waitFor(() => expect(timer()).toBeTruthy())

    setNow(new Date(NOW.getTime() + 9 * 60_000))
    fireEvent.click(screen.getByRole('button', { name: 'Finish now' }))

    await waitFor(() => expect(screen.getByText('Nothing running.')).toBeTruthy())
    const [session] = await focusSessionRepo.list()
    expect(session).toMatchObject({ outcome: 'completed', actualMin: 9 })
    expect(await focusEvents()).toEqual(['focus.started', 'focus.completed'])
  })

  it('keeps the minutes already spent when the session is stopped', async () => {
    await startFocus({ plannedMin: 25 })
    mount()
    await waitFor(() => expect(timer()).toBeTruthy())

    setNow(new Date(NOW.getTime() + 12 * 60_000))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(screen.getByText('Nothing running.')).toBeTruthy())
    expect((await focusSessionRepo.list())[0]).toMatchObject({
      outcome: 'aborted',
      actualMin: 12,
    })
  })

  it('finishes a session whose time ran out while the app was closed', async () => {
    /*
     * The laptop-lid case, and the reason the auto-finish lives in an effect on
     * the rendered remaining time rather than inside the tick: a session that
     * expired an hour ago is already at zero on the very first render, so it is
     * closed out without waiting for an interval that never ran.
     */
    await startFocus({ plannedMin: 25 })
    setNow(new Date(NOW.getTime() + 60 * 60_000))

    mount()

    await waitOutsideAct(async () => {
      expect((await focusSessionRepo.list())[0]?.endedAt).not.toBeNull()
    })
    const [session] = await focusSessionRepo.list()
    // The time recorded is the time that passed, not the time planned.
    expect(session).toMatchObject({ outcome: 'completed', actualMin: 60 })
    expect(await focusEvents()).toEqual(['focus.started', 'focus.completed'])
  })

  it('writes the finish once, however many renders observe zero', async () => {
    await startFocus({ plannedMin: 25 })
    setNow(new Date(NOW.getTime() + 60 * 60_000))

    mount()

    await waitOutsideAct(async () => {
      expect((await focusSessionRepo.list())[0]?.endedAt).not.toBeNull()
    })
    // A guard keyed on the session id, so the several renders that can see an
    // expired session between them produce exactly one write.
    expect(await focusEvents()).toEqual(['focus.started', 'focus.completed'])
  })
})

describe('the history', () => {
  it('says what is in it rather than showing a blank panel', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('No sessions yet')).toBeTruthy())
  })

  it('lists finished and stopped sessions with the time actually spent', async () => {
    const done = await startFocus({ plannedMin: 25 })
    setNow(new Date(NOW.getTime() + 25 * 60_000))
    await completeFocus(done.id)

    setNow(new Date(NOW.getTime() + 30 * 60_000))
    const stopped = await startFocus({ kind: 'short_break', plannedMin: 5 })
    setNow(new Date(NOW.getTime() + 32 * 60_000))
    await cancelFocus(stopped.id)

    mount()

    await waitFor(() => expect(screen.getByText('stopped')).toBeTruthy())
    expect(screen.getByText('finished')).toBeTruthy()
    expect(screen.getByText('25m')).toBeTruthy()
    // A stopped session shows both numbers, so the shortfall is visible.
    expect(screen.getByText('2m of 5m')).toBeTruthy()
  })
})

describe('the timer itself', () => {
  it('does not rebuild its interval on every tick', async () => {
    await startFocus({ plannedMin: 25 })
    const view = mount()
    await waitFor(() => expect(timer()).toBeTruthy())

    /*
     * The spy goes in *after* the screen has settled, so it counts only what
     * the running timer does — `waitFor` polls on an interval of its own.
     *
     * Two and a half seconds of real ticking, and the answer must be none —
     * the interval belongs to the session, not to the render. Depending on
     * anything that changes each tick (the current instant, most obviously)
     * rebuilds the timer inside its own callback and compounds: with `now` in
     * the dependencies this assertion sees tens of thousands of intervals in
     * these two and a half seconds rather than one.
     */
    const created = vi.spyOn(globalThis, 'setInterval')
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(created).not.toHaveBeenCalled()

    view.unmount()
  })

  it('stops ticking when the screen goes away', async () => {
    await startFocus({ plannedMin: 25 })
    const cleared = vi.spyOn(globalThis, 'clearInterval')

    const view = mount()
    await waitFor(() => expect(timer()).toBeTruthy())
    view.unmount()

    // Nothing left running to set state on a tree that no longer exists.
    expect(cleared).toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 1500))
  })

  it('runs no interval at all while nothing is in progress', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('Nothing running.')).toBeTruthy())

    const created = vi.spyOn(globalThis, 'setInterval')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(created).not.toHaveBeenCalled()
  })
})
