import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FocusDial } from './FocusDial'

/**
 * The ring is the only thing on the Focus screen that encodes a number as a
 * length, so the mapping from fraction to arc is worth pinning down: an arc
 * that is subtly wrong still looks like a plausible arc.
 *
 * `strokeDasharray` is the full circumference and `strokeDashoffset` is how
 * much of it is hidden, so offset/dasharray is exactly the *remaining*
 * proportion — which is what these assertions read.
 */

const arc = (): SVGCircleElement => {
  const circles = document.querySelectorAll('circle')
  const last = circles[circles.length - 1]
  if (!last) throw new Error('no arc rendered')
  return last as unknown as SVGCircleElement
}

/** How much of the ring is *unfilled*, 1 → 0. */
const hiddenFraction = (): number => {
  const circle = arc()
  const total = Number(circle.getAttribute('stroke-dasharray'))
  const offset = Number(circle.getAttribute('stroke-dashoffset'))
  return offset / total
}

describe('the focus dial', () => {
  it('leaves the ring empty at the start of a session', () => {
    render(<FocusDial elapsedFraction={0} display="25:00" />)
    expect(hiddenFraction()).toBeCloseTo(1, 5)
  })

  it('fills the ring in proportion to the time gone', () => {
    render(<FocusDial elapsedFraction={0.25} display="18:45" />)
    expect(hiddenFraction()).toBeCloseTo(0.75, 5)
  })

  it('closes the ring exactly once the planned time is gone', () => {
    render(<FocusDial elapsedFraction={1} display="00:00" />)
    expect(hiddenFraction()).toBeCloseTo(0, 5)
  })

  it('stops at a full ring rather than starting a second lap', () => {
    // Overrun keeps counting; the arc has nowhere further to go.
    render(<FocusDial elapsedFraction={2.5} display="00:00" overrun />)
    expect(hiddenFraction()).toBeCloseTo(0, 5)
  })

  it('refuses to run backwards on a nonsensical fraction', () => {
    render(<FocusDial elapsedFraction={-1} display="25:00" />)
    expect(hiddenFraction()).toBeCloseTo(1, 5)
  })

  it('switches the arc off the primary accent while overrunning', () => {
    const { rerender } = render(<FocusDial elapsedFraction={1} display="00:00" />)
    const normal = arc().getAttribute('stroke')
    rerender(<FocusDial elapsedFraction={1} display="00:00" overrun />)
    expect(arc().getAttribute('stroke')).not.toBe(normal)
  })

  it('carries the numerals as the timer, and announces nothing', () => {
    render(<FocusDial elapsedFraction={0.5} display="12:30" caption="Work · 25m" />)
    const timer = screen.getByRole('timer')
    expect(timer.textContent).toBe('12:30')
    // A countdown that speaks every second is unusable.
    expect(timer.getAttribute('aria-live')).toBe('off')
    expect(screen.getByText('Work · 25m')).toBeTruthy()
  })

  it('hides the ring itself from the accessibility tree', () => {
    // The numerals already say it; a second reading of the same fact as an
    // unlabelled graphic is noise.
    render(<FocusDial elapsedFraction={0.5} display="12:30" />)
    const svg = document.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })
})
