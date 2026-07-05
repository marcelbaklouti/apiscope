import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useDashboardStore } from '../lib/store'
import type { DependencyEdge, DependencyGraph, DependencyNode } from '../lib/types'

const ROW_HEIGHT = 32
const COLUMN_PADDING_TOP = 12

function dependencyNodeColor(kind: DependencyNode['kind']): string {
  if (kind === 'db') return 'var(--kind-db)'
  if (kind === 'http') return 'var(--status-3xx)'
  return 'var(--text)'
}

function edgeKey(edge: DependencyEdge): string {
  return `${edge.from}->${edge.to}`
}

export function Dependencies() {
  const [graph, setGraph] = useState<DependencyGraph | null>(null)
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null)
  const spans = useDashboardStore((state) => state.spans)

  useEffect(() => {
    void api
      .dependencies()
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], edges: [] }))
  }, [spans.length])

  const routeNodes = useMemo(() => graph?.nodes.filter((node) => node.kind === 'route') ?? [], [graph])
  const dependencyNodes = useMemo(() => graph?.nodes.filter((node) => node.kind !== 'route') ?? [], [graph])
  const edges = graph?.edges ?? []

  const maxCount = Math.max(1, ...edges.map((edge) => edge.count))
  const routeIndexById = new Map(routeNodes.map((node, index) => [node.id, index]))
  const dependencyIndexById = new Map(dependencyNodes.map((node, index) => [node.id, index]))
  const svgHeight = Math.max(routeNodes.length, dependencyNodes.length) * ROW_HEIGHT + COLUMN_PADDING_TOP * 2
  const hoveredEdge = edges.find((edge) => edgeKey(edge) === hoveredEdgeKey) ?? null

  if (graph === null) return <div className="empty">loading dependency graph</div>
  if (routeNodes.length === 0) {
    return <div className="empty">no requests with downstream calls captured yet</div>
  }

  return (
    <div>
      {hoveredEdge !== null && (
        <div className="card" data-testid="dependency-readout" style={{ marginBottom: 12 }}>
          <p className="metric" style={{ margin: 0 }}>
            {routeNodes.find((node) => node.id === hoveredEdge.from)?.label} → {dependencyNodes.find((node) => node.id === hoveredEdge.to)?.label}
          </p>
          <p className="metric" style={{ margin: '4px 0 0' }}>
            {hoveredEdge.count} calls · p95 {hoveredEdge.p95Ms.toFixed(1)}ms
          </p>
        </div>
      )}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px 1fr', gap: 0 }}>
          <div>
            {routeNodes.map((node) => (
              <div
                key={node.id}
                data-testid="dependency-route-node"
                className="mono"
                style={{
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: 8,
                  fontSize: 'var(--text-2xs)',
                  color:
                    hoveredEdge !== null && hoveredEdge.from === node.id ? 'var(--text)' : 'var(--text-dim)'
                }}
              >
                {node.label}
              </div>
            ))}
          </div>
          <svg
            data-testid="dependency-graph"
            viewBox={`0 0 240 ${svgHeight}`}
            width="240"
            height={svgHeight}
            style={{ display: 'block' }}
          >
            {edges.map((edge) => {
              const fromIndex = routeIndexById.get(edge.from)
              const toIndex = dependencyIndexById.get(edge.to)
              if (fromIndex === undefined || toIndex === undefined) return null
              const y1 = COLUMN_PADDING_TOP + fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2
              const y2 = COLUMN_PADDING_TOP + toIndex * ROW_HEIGHT + ROW_HEIGHT / 2
              const isHovered = hoveredEdgeKey === edgeKey(edge)
              const toNode = dependencyNodes.find((node) => node.id === edge.to)
              return (
                <path
                  key={edgeKey(edge)}
                  data-testid="dependency-edge"
                  d={`M 0 ${y1} C 100 ${y1}, 140 ${y2}, 240 ${y2}`}
                  fill="none"
                  stroke={toNode === undefined ? 'var(--text-dim)' : dependencyNodeColor(toNode.kind)}
                  strokeWidth={isHovered ? 4 : Math.max(1, (edge.count / maxCount) * 6)}
                  strokeOpacity={isHovered ? 1 : 0.55}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredEdgeKey(edgeKey(edge))}
                  onMouseLeave={() => setHoveredEdgeKey(null)}
                />
              )
            })}
          </svg>
          <div>
            {dependencyNodes.map((node) => (
              <div
                key={node.id}
                data-testid="dependency-target-node"
                className="mono"
                style={{
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 8,
                  fontSize: 'var(--text-2xs)',
                  color:
                    hoveredEdge !== null && hoveredEdge.to === node.id ? dependencyNodeColor(node.kind) : 'var(--text-dim)'
                }}
              >
                {node.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
