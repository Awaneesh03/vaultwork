import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOSAVE_DELAY_MS, useAutosave } from './useAutosave'

/**
 * The autosave hook.
 *
 * There is no save button anywhere in the notes feature, so this hook is the
 * only thing standing between a user's typing and their work existing. The
 * cases below are the three ways that can go wrong: losing the tail of an edit
 * on unmount, writing when nothing changed, and writing into the wrong note
 * after switching.
 *
 * Timers are faked here — unlike the database tests, there is no IndexedDB in
 * this file for `vi.useFakeTimers` to interfere with.
 */

function Harness({
  noteKey,
  save,
}: {
  noteKey: string | null
  save: (value: string) => Promise<unknown>
}) {
  const [value, setValue] = useState('')
  const autosave = useAutosave<string>(noteKey, '', save)

  return (
    <div>
      <input
        aria-label="body"
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          autosave.change(event.target.value)
        }}
        onBlur={autosave.flush}
      />
      <span data-testid="state">{autosave.state}</span>
    </div>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

// `fireEvent.change` goes through React's value tracker; assigning `.value`
// directly is silently ignored by a controlled input.
const type = async (text: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('body'), { target: { value: text } })
  })
}

const blur = async () => {
  await act(async () => {
    fireEvent.blur(screen.getByLabelText('body'))
  })
}

describe('debouncing', () => {
  it('waits before saving, then saves once', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<Harness noteKey="a" save={save} />)

    await type('h')
    await type('he')
    await type('hel')

    // Still nothing: the user is mid-word.
    expect(save).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    })

    // Three keystrokes, one write — which is the whole point of the debounce.
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('hel')
  })

  it('reports pending while the timer is running', async () => {
    render(<Harness noteKey="a" save={vi.fn().mockResolvedValue(undefined)} />)

    expect(screen.getByTestId('state').textContent).toBe('idle')
    await type('x')
    expect(screen.getByTestId('state').textContent).toBe('pending')

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    })
    expect(screen.getByTestId('state').textContent).toBe('saved')
  })

  it('writes nothing when the value returns to what was saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<Harness noteKey="a" save={save} />)

    await type('x')
    // Undo back to the original before the timer fires.
    await type('')

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2)
    })

    expect(save).not.toHaveBeenCalled()
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })
})

describe('flushing', () => {
  it('saves immediately on blur rather than waiting out the timer', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<Harness noteKey="a" save={save} />)

    await type('written')
    await blur()

    expect(save).toHaveBeenCalledWith('written')
  })

  it('saves the last keystrokes when the component unmounts', async () => {
    // Without this, navigating away inside the debounce window silently loses
    // whatever was typed last — the worst bug an autosaving editor can have.
    const save = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(<Harness noteKey="a" save={save} />)

    await type('nearly lost')
    expect(save).not.toHaveBeenCalled()

    await act(async () => {
      unmount()
    })

    expect(save).toHaveBeenCalledWith('nearly lost')
  })

  it('flushes the newest value, not the one captured when typing began', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(<Harness noteKey="a" save={save} />)

    await type('first')
    await type('second')
    await type('third')

    await act(async () => {
      unmount()
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('third')
  })
})

describe('switching subject', () => {
  it('does not write a pending value into the note you moved to', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<Harness noteKey="a" save={save} />)

    await type('belongs to a')
    await act(async () => {
      rerender(<Harness noteKey="b" save={save} />)
    })

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2)
    })

    // The pending edit belonged to the previous note and was dropped rather
    // than landing in the new one.
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })
})

describe('failure', () => {
  it('reports an error and keeps the text for a retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValue(undefined)

    render(<Harness noteKey="a" save={save} />)
    await type('important')

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    })
    expect(screen.getByTestId('state').textContent).toBe('error')

    // The value was not discarded: blurring retries it.
    await blur()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('important')
  })
})
