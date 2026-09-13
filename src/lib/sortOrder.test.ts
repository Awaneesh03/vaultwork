import { describe, expect, it } from 'vitest'
import {
  MIN_GAP,
  SORT_STEP,
  needsRebalance,
  orderAfterLast,
  orderBeforeFirst,
  orderBetween,
  orderForMove,
  respace,
} from './sortOrder'

describe('appending and prepending', () => {
  it('starts at the step for an empty list', () => {
    expect(orderAfterLast(undefined)).toBe(SORT_STEP)
    expect(orderBeforeFirst(undefined)).toBe(SORT_STEP)
  })

  it('leaves a full step of room on either end', () => {
    expect(orderAfterLast(3000)).toBe(4000)
    expect(orderBeforeFirst(1000)).toBe(0)
  })
})

describe('midpoints', () => {
  it('splits the gap between two neighbours', () => {
    expect(orderBetween(1000, 2000)).toBe(1500)
  })

  it('treats a missing neighbour as the end of the list', () => {
    expect(orderBetween(undefined, 2000)).toBe(1000)
    expect(orderBetween(3000, undefined)).toBe(4000)
    expect(orderBetween(undefined, undefined)).toBe(SORT_STEP)
  })

  it('flags a gap too small to split again', () => {
    expect(needsRebalance(1000, 2000)).toBe(false)
    expect(needsRebalance(1000, 1000 + MIN_GAP / 2)).toBe(true)
    expect(needsRebalance(1000, undefined)).toBe(false)
  })
})

describe('moving an item', () => {
  const orders = [1000, 2000, 3000, 4000]

  it('does not treat the moved item as its own neighbour', () => {
    // Moving index 0 to index 1 must land between 2000 and 3000, not between
    // 1000 and 2000 — the off-by-one every hand-rolled version gets wrong.
    expect(orderForMove(orders, 0, 1)).toBe(2500)
  })

  it('moves an item to the top', () => {
    expect(orderForMove(orders, 2, 0)).toBe(0)
  })

  it('moves an item to the bottom', () => {
    expect(orderForMove(orders, 0, 3)).toBe(5000)
  })

  it('moves an item up by one', () => {
    expect(orderForMove(orders, 3, 2)).toBe(2500)
  })

  it('clamps a target beyond the end of the list', () => {
    expect(orderForMove(orders, 0, 99)).toBe(5000)
  })

  it('lands back in the same slot when the indices match', () => {
    // Callers short-circuit a no-op move, but the arithmetic must still put
    // the item back between the same two neighbours rather than drifting.
    expect(orderForMove(orders, 1, 1)).toBe(2000)
  })
})

describe('repeated midpoints', () => {
  it('survives many drops into the same gap before precision runs out', () => {
    let before = 1000
    const after = 2000
    for (let i = 0; i < 40; i += 1) {
      const next = orderBetween(before, after)
      expect(next).toBeGreaterThan(before)
      expect(next).toBeLessThan(after)
      before = next
    }
    expect(needsRebalance(before, after)).toBe(true)
  })

  it('respaces to clean, evenly separated orders', () => {
    expect(respace(3)).toEqual([1000, 2000, 3000])
    expect(respace(0)).toEqual([])
  })
})
