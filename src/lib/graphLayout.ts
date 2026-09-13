/**
 * A small deterministic force-directed layout.
 *
 * Written by hand rather than pulled in: this is the whole algorithm, and a
 * graph library would add hundreds of kilobytes to a local-first app for one
 * screen. Three forces, a fixed iteration count, no animation loop.
 *
 * **Deterministic by construction.** The starting positions come from a seeded
 * hash of each node id rather than `Math.random`, so the same graph always
 * draws the same way — a layout that reshuffled on every render would make the
 * picture useless for recognising a familiar shape, and would be untestable.
 *
 * Pure: no React, no DOM, no clock.
 */

export interface LayoutNode {
  id: string
}

export interface LayoutEdge {
  source: string
  target: string
}

export interface Point {
  x: number
  y: number
}

export interface GraphLayout {
  positions: Map<string, Point>
  width: number
  height: number
}

export interface LayoutOptions {
  width?: number
  height?: number
  /** Held at the centre — the note a local graph is about. */
  pinned?: string | null
  iterations?: number
}

/** A stable 32-bit hash, so a node always starts in the same place. */
function seedOf(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193)
  }
  return (hash >>> 0) / 0xffffffff
}

const REPULSION = 6200
const SPRING = 0.035
const IDEAL_EDGE = 90
const CENTRING = 0.012
const DAMPING = 0.85

/**
 * Positions for every node.
 *
 * The forces are the classic three: nodes push each other apart, edges pull
 * their endpoints together, and everything drifts gently toward the middle so a
 * disconnected component cannot wander off the canvas.
 *
 * O(iterations · N²) for the repulsion pass. That is fine at the scale a graph
 * is *readable* at — a few hundred nodes — and beyond that the picture is an
 * unreadable hairball regardless, so the node count is capped by the caller
 * rather than the algorithm being made cleverer.
 */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): GraphLayout {
  const width = options.width ?? 800
  const height = options.height ?? 520
  const iterations = options.iterations ?? 260
  const centre = { x: width / 2, y: height / 2 }

  const positions = new Map<string, Point>()
  const velocity = new Map<string, Point>()

  // Seeded ring placement: spread around a circle by hash, so the initial
  // state is well distributed and identical every time.
  nodes.forEach((node, i) => {
    const seed = seedOf(node.id)
    const angle = seed * Math.PI * 2
    const radius = (0.25 + 0.6 * ((i % 7) / 7)) * Math.min(width, height) * 0.42
    positions.set(node.id, {
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
    })
    velocity.set(node.id, { x: 0, y: 0 })
  })

  if (options.pinned != null && positions.has(options.pinned)) {
    positions.set(options.pinned, { ...centre })
  }

  const present = edges.filter(
    (edge) =>
      edge.source !== edge.target && positions.has(edge.source) && positions.has(edge.target),
  )

  for (let step = 0; step < iterations; step += 1) {
    // Repulsion — every pair pushes apart.
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i] as LayoutNode
      const pa = positions.get(a.id) as Point
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j] as LayoutNode
        const pb = positions.get(b.id) as Point

        let dx = pa.x - pb.x
        let dy = pa.y - pb.y
        let distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < 0.01) {
          // Two nodes exactly on top of each other have no direction to push
          // in; nudge them apart deterministically rather than dividing by zero.
          dx = seedOf(a.id) - 0.5 || 0.5
          dy = seedOf(b.id) - 0.5 || 0.5
          distance = Math.sqrt(dx * dx + dy * dy)
        }

        const force = REPULSION / (distance * distance)
        const fx = (dx / distance) * force
        const fy = (dy / distance) * force

        const va = velocity.get(a.id) as Point
        const vb = velocity.get(b.id) as Point
        va.x += fx
        va.y += fy
        vb.x -= fx
        vb.y -= fy
      }
    }

    // Springs — edges pull toward the ideal length.
    for (const edge of present) {
      const pa = positions.get(edge.source) as Point
      const pb = positions.get(edge.target) as Point
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const distance = Math.max(0.01, Math.sqrt(dx * dx + dy * dy))
      const force = (distance - IDEAL_EDGE) * SPRING

      const fx = (dx / distance) * force
      const fy = (dy / distance) * force

      const va = velocity.get(edge.source) as Point
      const vb = velocity.get(edge.target) as Point
      va.x += fx
      va.y += fy
      vb.x -= fx
      vb.y -= fy
    }

    // Integrate, with a pull toward the centre and a clamp to the canvas.
    for (const node of nodes) {
      if (node.id === options.pinned) {
        velocity.set(node.id, { x: 0, y: 0 })
        positions.set(node.id, { ...centre })
        continue
      }

      const p = positions.get(node.id) as Point
      const v = velocity.get(node.id) as Point

      v.x = (v.x + (centre.x - p.x) * CENTRING) * DAMPING
      v.y = (v.y + (centre.y - p.y) * CENTRING) * DAMPING

      // A speed cap stops a dense graph from flinging nodes off-canvas in the
      // first few iterations, before repulsion has settled.
      const speed = Math.sqrt(v.x * v.x + v.y * v.y)
      if (speed > 24) {
        v.x = (v.x / speed) * 24
        v.y = (v.y / speed) * 24
      }

      p.x = Math.min(width - 40, Math.max(40, p.x + v.x))
      p.y = Math.min(height - 24, Math.max(24, p.y + v.y))
    }
  }

  return { positions, width, height }
}
