import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { layoutGraph, type GraphLayout } from '@/lib/graphLayout'
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@/services'

/**
 * The knowledge graph, drawn as SVG.
 *
 * Hand-rolled rather than pulling in a graph library. The layout is ~80 lines
 * of deterministic force simulation (`lib/graphLayout.ts`), and the drawing is
 * a few dozen SVG elements — against that, d3-force or cytoscape would add
 * hundreds of kilobytes to a local-first app for a screen most users open
 * occasionally. If the graph ever needs clustering or physics that survives
 * dragging, that trade changes; today it does not.
 *
 * Every node is a real `<button>`, so the graph is reachable by keyboard and a
 * screen reader hears "Binary Search, 3 links" rather than nothing at all. That
 * is also why the node list is rendered as a visually-hidden list underneath:
 * an SVG scatter plot is not navigable, and the same information has to exist
 * in a form that is.
 */

export interface KnowledgeGraphViewProps {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  /** Highlighted, and placed at the centre. */
  focusNoteId?: string | null
  selectedNoteId?: string | null
  onSelect?: (noteId: string) => void
  onOpen?: (noteId: string) => void
  className?: string
  height?: number
}

const WIDTH = 800
const HEIGHT = 520

export function KnowledgeGraphView({
  nodes,
  edges,
  focusNoteId = null,
  selectedNoteId = null,
  onSelect,
  onOpen,
  className,
  height = HEIGHT,
}: KnowledgeGraphViewProps) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragging = useRef<{ x: number; y: number } | null>(null)

  /**
   * A key describing the graph's *shape*, not the array identity.
   *
   * `nodes` and `edges` are rebuilt on every live-query tick even when nothing
   * changed, so memoising on their identity would re-run 260 force iterations
   * whenever any note in the database was touched. Keying on the ids means the
   * simulation runs only when the graph actually differs.
   */
  const shape = useMemo(
    () =>
      [
        focusNoteId ?? '',
        nodes.map((node) => node.id).join(','),
        edges.map((edge) => `${edge.source}>${edge.target}`).join(','),
      ].join('|'),
    [nodes, edges, focusNoteId],
  )

  const layout: GraphLayout = useMemo(
    () => layoutGraph(nodes, edges, { width: WIDTH, height: HEIGHT, pinned: focusNoteId }),
    // Intentionally keyed on the shape rather than the arrays: see above. The
    // arrays are read inside, but a change to them that leaves the shape
    // identical cannot alter the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape],
  )

  // Reset the viewport when the graph changes underneath, so a filter does not
  // leave the user looking at empty space.
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [focusNoteId, nodes.length])

  const positions = layout.positions

  if (nodes.length === 0) {
    return (
      <div
        className={cn(
          'grid place-items-center rounded-lg border border-dashed border-line bg-surface',
          className,
        )}
        style={{ height }}
      >
        <p className="px-4 text-center text-[12.5px] text-ink-3">
          Nothing to draw. Link notes with <code className="font-mono">[[wikilinks]]</code> and they
          will appear here.
        </p>
      </div>
    )
  }

  const degreeOf = (node: KnowledgeGraphNode) => node.incomingCount + node.outgoingCount
  const radiusOf = (node: KnowledgeGraphNode) => 5 + Math.min(7, degreeOf(node) * 1.4)

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative overflow-hidden rounded-lg border border-line bg-surface">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`Knowledge graph: ${nodes.length} notes, ${edges.length} links`}
          className="block touch-none select-none"
          onPointerDown={(event) => {
            dragging.current = { x: event.clientX - pan.x, y: event.clientY - pan.y }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (dragging.current === null) return
            setPan({
              x: event.clientX - dragging.current.x,
              y: event.clientY - dragging.current.y,
            })
          }}
          onPointerUp={() => {
            dragging.current = null
          }}
          onWheel={(event) => {
            // Trackpad and wheel both arrive here; clamped so the graph cannot
            // be zoomed into oblivion or shrunk to a dot.
            setZoom((current) =>
              Math.min(3, Math.max(0.4, current * (event.deltaY < 0 ? 1.1 : 0.9))),
            )
          }}
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {edges.map((edge) => {
              const from = positions.get(edge.source)
              const to = positions.get(edge.target)
              if (!from || !to) return null

              // A self-link is drawn as a loop; a straight line would be a dot.
              if (edge.source === edge.target) {
                const r = 14
                return (
                  <path
                    key={`${edge.source}->${edge.target}`}
                    d={`M ${from.x} ${from.y - 4} a ${r} ${r} 0 1 1 4 0`}
                    fill="none"
                    className="stroke-line-strong"
                    strokeWidth={1}
                  />
                )
              }

              const highlighted =
                selectedNoteId !== null &&
                (edge.source === selectedNoteId || edge.target === selectedNoteId)

              return (
                <line
                  key={`${edge.source}->${edge.target}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className={highlighted ? 'stroke-accent' : 'stroke-line-strong'}
                  strokeWidth={highlighted ? 1.6 : 1}
                  strokeOpacity={highlighted ? 0.9 : 0.5}
                />
              )
            })}

            {nodes.map((node) => {
              const at = positions.get(node.id)
              if (!at) return null
              const focused = node.id === focusNoteId
              const selected = node.id === selectedNoteId
              const radius = radiusOf(node)

              return (
                <g key={node.id}>
                  <circle
                    cx={at.x}
                    cy={at.y}
                    r={radius}
                    className={cn(
                      'cursor-pointer transition-colors',
                      focused || selected
                        ? 'fill-accent stroke-accent'
                        : 'fill-elevated stroke-line-strong',
                    )}
                    strokeWidth={focused ? 2 : 1}
                    onClick={() => onSelect?.(node.id)}
                    onDoubleClick={() => onOpen?.(node.id)}
                  />
                  <text
                    x={at.x}
                    y={at.y + radius + 11}
                    textAnchor="middle"
                    className={cn(
                      'pointer-events-none text-[9px]',
                      focused || selected ? 'fill-ink' : 'fill-ink-3',
                    )}
                  >
                    {node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-elevated/90 px-2 py-1 text-[10.5px] text-ink-3">
          Drag to pan · scroll to zoom · double-click a node to open
        </div>
      </div>

      {/*
        The same graph as a list. An SVG scatter plot cannot be tabbed through
        or read aloud, so every node also exists as a real button here — this is
        the keyboard and screen-reader path, not a decoration.
      */}
      <ul className="flex flex-wrap gap-1">
        {nodes.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect?.(node.id)}
              onDoubleClick={() => onOpen?.(node.id)}
              aria-pressed={node.id === selectedNoteId}
              className={cn(
                'rounded-md border px-2 py-1 text-[11.5px] transition-colors',
                node.id === selectedNoteId || node.id === focusNoteId
                  ? 'border-accent-line bg-accent-soft text-accent'
                  : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2',
              )}
            >
              {node.title}
              <span className="ml-1 text-ink-3" aria-hidden>
                {degreeOf(node)}
              </span>
              <span className="sr-only">
                , {node.incomingCount} incoming and {node.outgoingCount} outgoing links
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
