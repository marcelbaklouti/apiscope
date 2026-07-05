import type { ChildSpan, RequestSpan } from '@apiscope/core'

export interface DependencyNode {
  id: string
  kind: 'route' | 'db' | 'http'
  label: string
}

export interface DependencyEdge {
  from: string
  to: string
  count: number
  p95Ms: number
}

export interface DependencyGraph {
  nodes: DependencyNode[]
  edges: DependencyEdge[]
}

export interface SpanWithChildren {
  span: RequestSpan
  childSpans: ChildSpan[]
}

function routeNodeId(method: string, routePattern: string): string {
  return `route:${method} ${routePattern}`
}

function dependencyNodeFor(childSpan: ChildSpan): DependencyNode {
  if (childSpan.kind === 'db') {
    return {
      id: `db:${childSpan.system}:${childSpan.target ?? ''}`,
      kind: 'db',
      label: `${childSpan.system} ${childSpan.target ?? ''}`.trim()
    }
  }
  const host = (() => {
    try {
      return new URL(childSpan.url).host
    } catch {
      return childSpan.url
    }
  })()
  return { id: `http:${host}`, kind: 'http', label: host }
}

function percentile(durationsMs: number[], quantile: number): number {
  if (durationsMs.length === 0) return 0
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const offset = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)
  return sorted[Math.max(0, offset)] ?? 0
}

interface EdgeAccumulator {
  from: string
  to: string
  durationsMs: number[]
}

export function buildDependencyGraph(spansWithChildren: SpanWithChildren[]): DependencyGraph {
  const nodesById = new Map<string, DependencyNode>()
  const edgesByKey = new Map<string, EdgeAccumulator>()

  for (const { span, childSpans } of spansWithChildren) {
    if (span.routePattern === null || span.routePattern === undefined) continue
    const routeId = routeNodeId(span.method, span.routePattern)
    if (!nodesById.has(routeId)) {
      nodesById.set(routeId, { id: routeId, kind: 'route', label: `${span.method} ${span.routePattern}` })
    }
    for (const childSpan of childSpans) {
      const dependencyNode = dependencyNodeFor(childSpan)
      if (!nodesById.has(dependencyNode.id)) nodesById.set(dependencyNode.id, dependencyNode)
      const edgeKey = `${routeId} ${dependencyNode.id}`
      const accumulator = edgesByKey.get(edgeKey) ?? { from: routeId, to: dependencyNode.id, durationsMs: [] }
      accumulator.durationsMs.push(childSpan.timing.duration)
      edgesByKey.set(edgeKey, accumulator)
    }
  }

  const edges: DependencyEdge[] = [...edgesByKey.values()].map((accumulator) => ({
    from: accumulator.from,
    to: accumulator.to,
    count: accumulator.durationsMs.length,
    p95Ms: percentile(accumulator.durationsMs, 0.95)
  }))

  return { nodes: [...nodesById.values()], edges }
}
