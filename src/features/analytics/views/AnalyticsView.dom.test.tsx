import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { eventRepo, focusSessionRepo } from '@/repositories'
import type { EventSource } from '@/types/enums'
import { freezeClock, resetDatabase, waitOutsideAct } from '../../../../tests/helpers'
import { AnalyticsView } from './AnalyticsView'

/**
 * The Analytics screen, mounted against a real database.
 *
 * `analyticsQueryService.test.ts` proves the counting. This proves the screen
 * shows what was counted — including the two states a dashboard most often gets
 * wrong: an empty range, which must say it is empty rather than draw a
 * confident flat line, and a range change, which must re-query rather than
 * repaint stale numbers.
 */

// Thursday 3 September 2026, ten in the morning.
const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const plant = (type: string, at: Date, entityType = 'task', source: EventSource = 'ui') =>
  eventRepo.append({ type, entityType, entityId: 'x', source, at: at.getTime() })

const plantFocus = (endedAt: Date, actualMin: number) =>
  focusSessionRepo.create(
    {
      taskId: null,
      projectId: null,
      kind: 'work',
      startedAt: endedAt.getTime() - actualMin * 60_000,
      endedAt: endedAt.getTime(),
      plannedMin: 25,
      actualMin,
      outcome: 'completed',
    },
    { emit: false },
  )

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/analytics']}>
      <AnalyticsView />
    </MemoryRouter>,
  )

/**
 * A labelled figure, read by its label rather than by position.
 *
 * The page has two kinds now — the headline band at the top and the totals
 * strip at the bottom — and both pair an eyebrow with its value in the same
 * container, so one helper reads either.
 */
const stat = (label: string) => {
  const tile = screen.getByText(label).closest('div')
  if (tile === null) throw new Error(`No figure for ${label}`)
  return tile.textContent ?? ''
}

/** The accessible table each chart carries, so the assertions read real rows. */
const chartRows = (label: string) => {
  const table = screen.getByRole('table', { name: `${label} by day` })
  return within(table)
    .getAllByRole('row')
    .map((row) => row.textContent ?? '')
}

describe('an empty range', () => {
  it('says there is nothing rather than drawing zeroes as a trend', async () => {
    mount()

    await waitFor(() => expect(screen.getByText('Nothing in this range yet')).toBeTruthy())
    expect(screen.queryByRole('table', { name: 'Tasks completed by day' })).toBeNull()
  })
})

describe('with history', () => {
  beforeEach(async () => {
    await plant('task.completed', new Date(2026, 8, 3, 9, 0))
    await plant('task.completed', new Date(2026, 8, 3, 9, 30))
    await plant('task.completed', new Date(2026, 8, 2, 15, 0))
    await plant('task.created', new Date(2026, 8, 3, 8, 0))
    await plant('habit.completed', new Date(2026, 8, 2, 7, 0), 'habit')
    await plant('note.updated', new Date(2026, 8, 3, 9, 45), 'note')
    await plantFocus(new Date(2026, 8, 3, 9, 50), 25)
    await plantFocus(new Date(2026, 8, 2, 16, 0), 35)
  })

  it('leads with the totals as numbers, not as charts', async () => {
    mount()

    // Tasks completed is the headline: the one series that answers "did I move
    // my own work forward". It gets the largest numeral on the page.
    await waitFor(() => expect(stat('Tasks completed')).toContain('3'))
    expect(stat('Created')).toContain('1')

    // The rest are facts rather than shapes, in the totals strip.
    // Each supporting chart now carries its own total beside its caption, so
    // no measure is named twice on the page.
    expect(stat('Habit check-ins')).toContain('1')
    expect(stat('Focus minutes')).toContain('1h')
    expect(stat('Focus sessions')).toContain('2')
  })

  it('names the busiest hour in words rather than as a number of the clock', async () => {
    mount()
    await waitFor(() => expect(stat('Busiest hour')).toContain('9 am'))
  })

  it('gives each measure its own chart, on its own scale', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('Tasks completed')).toBeTruthy())

    // Tasks and minutes are different units. One axis each — never a shared one.
    for (const label of ['Tasks completed', 'Focus minutes', 'Habit check-ins', 'Notes written']) {
      expect(screen.getByRole('table', { name: `${label} by day` })).toBeTruthy()
    }
  })

  it('puts the numbers in a table too, so identity is never colour alone', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('Tasks completed')).toBeTruthy())

    const rows = chartRows('Tasks completed')
    expect(rows).toHaveLength(7)
    expect(rows.at(-1)).toContain('2 tasks')
    expect(rows.at(-2)).toContain('1 task')
    // A quiet day is a zero, not a missing column.
    expect(rows[0]).toContain('0 tasks')
  })

  it('reads focus minutes in hours and minutes, not as a bare count', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('Focus minutes')).toBeTruthy())

    const rows = chartRows('Focus minutes')
    expect(rows.at(-1)).toContain('25m')
    expect(rows.at(-2)).toContain('35m')
    expect(rows[0]).toContain('none')
  })
})

describe('the range control', () => {
  it('starts on a week and says which range is showing', async () => {
    await plant('task.completed', new Date(2026, 8, 3, 9, 0))
    mount()

    await waitFor(() => expect(screen.getByRole('button', { name: '7 days' })).toBeTruthy())
    expect(screen.getByRole('button', { name: '7 days' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('re-queries rather than repainting the numbers it already had', async () => {
    // Inside the month, outside the week.
    await plant('task.completed', new Date(2026, 7, 20, 10, 0))
    await plant('task.completed', new Date(2026, 8, 3, 9, 0))

    mount()
    await waitFor(() => expect(stat('Tasks completed')).toContain('1'))

    fireEvent.click(screen.getByRole('button', { name: '30 days' }))

    // The range is part of the query key, so the older completion appears.
    await waitOutsideAct(() => {
      expect(stat('Tasks completed')).toContain('2')
    })
    expect(chartRows('Tasks completed')).toHaveLength(30)
  })

  it('can show a quarter', async () => {
    await plant('task.completed', new Date(2026, 8, 3, 9, 0))
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: '90 days' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '90 days' }))

    await waitOutsideAct(() => {
      expect(chartRows('Tasks completed')).toHaveLength(90)
    })
  })
})

describe('a range with focus but no events', () => {
  it('is not treated as empty', async () => {
    await plantFocus(new Date(2026, 8, 3, 9, 50), 25)
    mount()

    await waitFor(() => expect(stat('Focus minutes')).toContain('25m'))
    expect(screen.queryByText('Nothing in this range yet')).toBeNull()
  })
})
