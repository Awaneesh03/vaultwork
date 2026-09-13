/**
 * Manual ordering.
 *
 * Rows carry a numeric `sortOrder` spaced 1,000 apart (the convention the seed
 * data established). Moving an item computes a value *between* its new
 * neighbours, so a drag writes exactly one row instead of renumbering the
 * whole list — which matters both for write amplification and because a
 * renumber emits an event per row and poisons the log.
 *
 * Floating-point midpoints run out of room after ~50 consecutive drops into
 * the same gap. `needsRebalance` says when that has happened; the caller then
 * respaces the list once, deliberately, rather than silently colliding.
 */

export const SORT_STEP = 1000

/** Smallest gap worth splitting. Below this, respace instead. */
export const MIN_GAP = 0.5

/** Order for an item appended after everything else. */
export function orderAfterLast(lastOrder: number | undefined): number {
  return lastOrder === undefined ? SORT_STEP : lastOrder + SORT_STEP
}

/** Order for an item placed before everything else. */
export function orderBeforeFirst(firstOrder: number | undefined): number {
  return firstOrder === undefined ? SORT_STEP : firstOrder - SORT_STEP
}

/**
 * Order for an item dropped between two neighbours. Either side may be
 * `undefined`, meaning "the item went to that end of the list".
 */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return SORT_STEP
  if (before === undefined) return orderBeforeFirst(after)
  if (after === undefined) return orderAfterLast(before)
  return (before + after) / 2
}

export function needsRebalance(before: number | undefined, after: number | undefined): boolean {
  if (before === undefined || after === undefined) return false
  return Math.abs(after - before) < MIN_GAP
}

/** Evenly respaced orders for a list that has run out of precision. */
export function respace(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * SORT_STEP)
}

/**
 * Where an item lands when moved from `fromIndex` to `toIndex` in a list
 * ordered by `orders`. The removed item is not its own neighbour, which is the
 * off-by-one every hand-rolled version of this gets wrong.
 */
export function orderForMove(orders: number[], fromIndex: number, toIndex: number): number {
  const without = orders.filter((_, i) => i !== fromIndex)
  const target = Math.max(0, Math.min(toIndex, without.length))
  return orderBetween(without[target - 1], without[target])
}
