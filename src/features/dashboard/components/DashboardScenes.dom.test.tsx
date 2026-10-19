import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CITY_BACK, CITY_FRONT, roofsOf, windowsFor } from '../skyline'
import type { TimeOfDay } from '../timeOfDay'
import { DashboardHeader } from './DashboardHeader'

/**
 * The hero's four scenes: one per time of day, distinct from each other, in
 * agreement with the words over them, and drawn with nothing that needs the
 * network or ignores a request for reduced motion.
 */

const TIMES: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night']

const renderHero = (timeOfDay: TimeOfDay) =>
  render(<DashboardHeader timeOfDay={timeOfDay} today="2026-09-03" />)

describe('each scene', () => {
  it.each([
    ['morning', 'Morning Focus', 'Good morning.', 'A fresh start. Let’s make today count.'],
    ['afternoon', 'Day in Motion', 'Make today count.', 'Keep moving. Every small step matters.'],
    ['evening', 'Evening Wrap-Up', 'Good evening.', 'Great progress today. Let’s wrap things up.'],
    ['night', 'Night Wind-Down', 'Good night.', 'Time to rest. Tomorrow is lined up below.'],
  ] as const)('%s pairs its sky with its own words', (timeOfDay, eyebrow, heading, subtitle) => {
    const { container } = renderHero(timeOfDay)

    expect(container.querySelector('header')?.getAttribute('data-scene')).toBe(timeOfDay)
    expect(container.querySelector('[data-scene-art]')?.getAttribute('data-scene-art')).toBe(
      timeOfDay,
    )
    expect(screen.getByText(eyebrow)).toBeTruthy()
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    expect(screen.getByText(subtitle)).toBeTruthy()
  })

  it('draws the sun by day and the moon, stars and lit windows only at night', () => {
    for (const timeOfDay of TIMES) {
      const { container, unmount } = renderHero(timeOfDay)
      const has = (part: string) => container.querySelector(`[data-part="${part}"]`) !== null
      const night = timeOfDay === 'night'

      expect(has('sun'), timeOfDay).toBe(!night)
      expect(has('moon'), timeOfDay).toBe(night)
      expect(has('stars'), timeOfDay).toBe(night)
      expect(has('lit-windows'), timeOfDay).toBe(night)
      unmount()
    }
  })

  it('keeps the closing line for the end of the day only', () => {
    for (const timeOfDay of TIMES) {
      const { container, unmount } = renderHero(timeOfDay)
      const closing = [...container.querySelectorAll('p')].some((p) =>
        /results|tomorrow\.|work\.|counts\.|intensity\./.test(p.textContent ?? ''),
      )
      expect(closing, timeOfDay).toBe(timeOfDay === 'evening' || timeOfDay === 'night')
      unmount()
    }
  })

  it('keeps every scene decorative, out of the accessibility tree and the pointer’s way', () => {
    for (const timeOfDay of TIMES) {
      const { container, unmount } = renderHero(timeOfDay)
      const art = container.querySelector('[data-scene-art]')
      expect(art?.getAttribute('aria-hidden')).toBe('true')
      expect(art?.className).toContain('pointer-events-none')
      unmount()
    }
  })

  it('loads nothing: no image, no remote URL', () => {
    for (const timeOfDay of TIMES) {
      const { container, unmount } = renderHero(timeOfDay)
      expect(container.querySelector('img, image, use[href]')).toBeNull()
      expect(container.innerHTML).not.toMatch(/https?:\/\/|url\(/)
      unmount()
    }
  })
})

describe('the lit windows', () => {
  it('only ever sit inside a building', () => {
    for (const [path, base] of [
      [CITY_BACK, 120],
      [CITY_FRONT, 80],
    ] as const) {
      const roofs = roofsOf(path, base)
      const lit = windowsFor(path, base)
      expect(lit.length).toBeGreaterThan(10)
      for (const w of lit) {
        const roof = roofs.find((r) => w.x >= r.x && w.x + 2 <= r.x + r.width)
        expect(roof, `window at ${w.x},${w.y}`).toBeDefined()
        if (!roof) continue
        expect(w.y).toBeGreaterThan(roof.top)
        expect(w.y + 3).toBeLessThanOrEqual(base)
      }
    }
  })

  it('are the same every night', () => {
    expect(windowsFor(CITY_FRONT, 80)).toEqual(windowsFor(CITY_FRONT, 80))
  })
})

describe('motion', () => {
  // Read from disk: Vitest does not run stylesheets through Vite's `?raw`.
  const globalsCss = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8')

  it('drifts clouds only when reduced motion has not been asked for', () => {
    expect(globalsCss).toContain('@keyframes scene-drift')
    // The animation is attached in exactly one place, inside a
    // `prefers-reduced-motion: no-preference` block. With reduced motion on,
    // `.scene-drift` has no animation at all — the scene is a still picture.
    const attachments = [...globalsCss.matchAll(/animation:\s*scene-drift/g)]
    expect(attachments).toHaveLength(1)

    const block = globalsCss.indexOf('@media (prefers-reduced-motion: no-preference)')
    const attached = globalsCss.indexOf('animation: scene-drift')
    expect(block).toBeGreaterThan(-1)
    expect(attached).toBeGreaterThan(block)
    expect(globalsCss.slice(block, attached)).not.toContain('}\n}')
  })
})
