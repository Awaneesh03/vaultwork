import { describe, expect, it } from 'vitest'
import { cn, TEXT_SCALE } from './cn'

/**
 * Class merging, for the one case that was silently wrong.
 *
 * `tailwind-merge` groups classes so a later utility can beat an earlier one.
 * It has to be told that `text-body` names a size; without that it files every
 * unfamiliar `text-*` as a colour, decides a size and a colour are the same
 * kind of thing, and throws one of them away.
 */

describe('the type scale', () => {
  it('keeps a size and a colour together', () => {
    // This is the regression: the size used to be dropped entirely.
    for (const size of TEXT_SCALE) {
      const merged = cn(`text-${size}`, 'text-ink')
      expect(merged).toContain(`text-${size}`)
      expect(merged).toContain('text-ink')
    }
  })

  it('still lets a later size win over an earlier one', () => {
    expect(cn('text-body', 'text-title')).toBe('text-title')
    expect(cn('text-display', 'text-micro')).toBe('text-micro')
  })

  it('still lets a later colour win over an earlier one', () => {
    expect(cn('text-ink-3', 'text-accent')).toBe('text-accent')
    expect(cn('text-body text-ink-3', 'text-danger')).toBe('text-body text-danger')
  })

  it('leaves the stock Tailwind scale alone', () => {
    expect(cn('text-sm', 'text-lg')).toBe('text-lg')
    expect(cn('text-sm', 'text-ink')).toBe('text-sm text-ink')
  })

  it('does not confuse a size with an arbitrary one', () => {
    expect(cn('text-[40px]', 'text-ink')).toBe('text-[40px] text-ink')
    expect(cn('text-body', 'text-[40px]')).toBe('text-[40px]')
  })

  it('still drops a duplicate of anything else', () => {
    expect(cn('px-2', 'px-3')).toBe('px-3')
  })
})
