import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useDialogFocus } from './useDialogFocus'

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>()
  return (
    <div
      role="dialog"
      aria-label="Picker"
      ref={ref}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <button type="button">First</button>
      <button type="button">Last</button>
    </div>
  )
}

function Page() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

describe('dialog focus', () => {
  it('moves focus inside on open, so Escape works straight away', () => {
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('returns focus to the opener on close', () => {
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })

    expect(document.activeElement).toBe(opener)
  })

  it('keeps Tab inside the dialog', () => {
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})
