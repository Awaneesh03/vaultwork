import { describe, expect, it } from 'vitest'
import { layoutGraph } from './graphLayout'

/**
 * The graph layout.
 *
 * The property that matters is determinism: the same graph must draw the same
 * way every time, or the picture is useless for recognising a familiar shape
 * and impossible to assert anything about.
 */

const nodes = (...ids: string[]) => ids.map((id) => ({ id }))

describe('layoutGraph', () => {
  it('positions every node', () => {
    const layout = layoutGraph(nodes('a', 'b', 'c'), [{ source: 'a', target: 'b' }])
    expect(layout.positions.size).toBe(3)
    for (const id of ['a', 'b', 'c']) {
      const point = layout.positions.get(id)
      expect(Number.isFinite(point?.x)).toBe(true)
      expect(Number.isFinite(point?.y)).toBe(true)
    }
  })

  it('is deterministic — the same graph draws identically', () => {
    const graph = () => layoutGraph(nodes('a', 'b', 'c'), [{ source: 'a', target: 'b' }])
    const first = graph()
    const second = graph()

    for (const id of ['a', 'b', 'c']) {
      expect(second.positions.get(id)).toEqual(first.positions.get(id))
    }
  })

  it('keeps every node inside the canvas', () => {
    const layout = layoutGraph(
      nodes('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'),
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
      { width: 400, height: 300 },
    )

    for (const point of layout.positions.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(400)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(300)
    }
  })

  it('pins the focused node to the centre', () => {
    const layout = layoutGraph(nodes('a', 'b', 'c'), [{ source: 'a', target: 'b' }], {
      width: 800,
      height: 520,
      pinned: 'a',
    })
    expect(layout.positions.get('a')).toEqual({ x: 400, y: 260 })
  })

  it('pulls linked nodes closer than unlinked ones', () => {
    const layout = layoutGraph(nodes('a', 'b', 'far'), [{ source: 'a', target: 'b' }])
    const distance = (p: string, q: string) => {
      const one = layout.positions.get(p) as { x: number; y: number }
      const two = layout.positions.get(q) as { x: number; y: number }
      return Math.hypot(one.x - two.x, one.y - two.y)
    }
    expect(distance('a', 'b')).toBeLessThan(distance('a', 'far'))
  })

  it('separates two nodes that would otherwise coincide', () => {
    const layout = layoutGraph(nodes('a', 'b'), [])
    const a = layout.positions.get('a') as { x: number; y: number }
    const b = layout.positions.get('b') as { x: number; y: number }
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1)
  })

  it('ignores a self-edge rather than dividing by zero', () => {
    const layout = layoutGraph(nodes('a'), [{ source: 'a', target: 'a' }])
    const a = layout.positions.get('a') as { x: number; y: number }
    expect(Number.isFinite(a.x)).toBe(true)
    expect(Number.isFinite(a.y)).toBe(true)
  })

  it('ignores an edge naming a node that is not there', () => {
    const layout = layoutGraph(nodes('a'), [{ source: 'a', target: 'ghost' }])
    expect(layout.positions.size).toBe(1)
    expect(Number.isFinite(layout.positions.get('a')?.x)).toBe(true)
  })

  it('handles an empty graph', () => {
    expect(layoutGraph([], []).positions.size).toBe(0)
  })

  it('stays responsive at a readable graph size', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `n${i}` }))
    const edges = many.slice(1).map((node, i) => ({ source: `n${i}`, target: node.id }))

    const started = Date.now()
    const layout = layoutGraph(many, edges)
    expect(layout.positions.size).toBe(150)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
