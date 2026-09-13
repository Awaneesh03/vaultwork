import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataView } from './DataView'

/**
 * DataView is the one component every future feature depends on, and the reason
 * it exists is that "forgot the empty state" is the most common way a list view
 * ships broken. So the four states are tested here, once, rather than eleven
 * times later.
 */
describe('DataView', () => {
  it('shows a skeleton while data is undefined', () => {
    const { container } = render(<DataView data={undefined}>{() => <p>content</p>}</DataView>)

    expect(screen.queryByText('content')).toBeNull()
    // The contract is the announced status, not the styling: a screen reader
    // must be told something is loading, whatever the placeholder looks like.
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })

  it('renders content once data arrives', () => {
    render(<DataView data={['a', 'b']}>{(rows) => <p>{rows.length} rows</p>}</DataView>)
    expect(screen.getByText('2 rows')).toBeTruthy()
  })

  it('renders the empty state instead of an empty list', () => {
    render(
      <DataView
        data={[]}
        isEmpty={(rows) => rows.length === 0}
        empty={<p>Nothing scheduled — pull something from Upcoming?</p>}
      >
        {(rows) => <p>{rows.length} rows</p>}
      </DataView>,
    )

    expect(screen.getByText(/Nothing scheduled/)).toBeTruthy()
    expect(screen.queryByText('0 rows')).toBeNull()
  })

  it('shows the error with a working retry, and never the content', () => {
    const onRetry = vi.fn()
    render(
      <DataView data={['a']} error={new Error('IndexedDB is unavailable')} onRetry={onRetry}>
        {() => <p>content</p>}
      </DataView>,
    )

    expect(screen.getByText('IndexedDB is unavailable')).toBeTruthy()
    expect(screen.queryByText('content')).toBeNull()

    screen.getByRole('button', { name: 'Try again' }).click()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('prefers the error state over loading', () => {
    render(
      <DataView data={undefined} error={new Error('boom')}>
        {() => <p>content</p>}
      </DataView>,
    )
    expect(screen.getByText('boom')).toBeTruthy()
  })
})
