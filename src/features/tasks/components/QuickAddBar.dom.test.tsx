import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuickAddBar } from './QuickAddBar'

/**
 * Enter is not a disabled button: holding it, or pressing it twice while the
 * first save is still in flight, must create one task, not two.
 */
describe('quick add', () => {
  it('submits once when Enter is pressed again before the first save finishes', async () => {
    let finish: (ok: boolean) => void = () => {}
    const onSubmitText = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    )
    render(
      <QuickAddBar
        today="2026-09-21"
        tags={[]}
        projects={[]}
        onSubmitText={onSubmitText}
        onSubmitForm={async () => true}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Quick add a task' })
    fireEvent.change(input, { target: { value: 'Study Java' } })

    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmitText).toHaveBeenCalledTimes(1)

    await act(async () => finish(true))
    fireEvent.change(input, { target: { value: 'Study Rust' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmitText).toHaveBeenCalledTimes(2)
  })
})
