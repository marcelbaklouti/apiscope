import { describe, expect, it } from 'vitest'
import type { ChildSpan, RequestSpan } from '@apiscope/core'
import { buildDependencyGraph } from '../src/analysis/dependencies'

function span(id: string, method: string, routePattern: string, durationMs: number): RequestSpan {
  return {
    id,
    traceId: `trace-${id}`,
    method,
    routePattern,
    actualPath: routePattern,
    statusCode: 200,
    timing: { start: 0, ttfb: null, duration: durationMs },
    framework: 'express',
    runtime: 'node'
  }
}

function dbChild(id: string, parentSpanId: string, durationMs: number): ChildSpan {
  return {
    id,
    parentSpanId,
    traceId: `trace-${parentSpanId}`,
    kind: 'db',
    system: 'postgresql',
    statement: 'SELECT * FROM users WHERE id = ?',
    operation: 'SELECT',
    target: 'appdb',
    rowCount: 1,
    timing: { start: 0, ttfb: null, duration: durationMs }
  }
}

function fetchChild(id: string, parentSpanId: string, url: string, durationMs: number): ChildSpan {
  return {
    id,
    parentSpanId,
    traceId: `trace-${parentSpanId}`,
    kind: 'fetch',
    url,
    method: 'GET',
    statusCode: 200,
    timing: { start: 0, ttfb: null, duration: durationMs }
  }
}

describe('buildDependencyGraph', () => {
  it('builds route and dependency nodes with aggregated edges across two routes', () => {
    const spansWithChildren = [
      {
        span: span('s1', 'GET', '/api/users/:id', 10),
        childSpans: [dbChild('c1', 's1', 4), fetchChild('f1', 's1', 'http://127.0.0.1:9999/downstream', 6)]
      },
      {
        span: span('s2', 'GET', '/api/users/:id', 12),
        childSpans: [dbChild('c2', 's2', 8)]
      },
      {
        span: span('s3', 'POST', '/api/orders', 20),
        childSpans: [dbChild('c3', 's3', 5)]
      }
    ]

    const graph = buildDependencyGraph(spansWithChildren)

    const routeNodes = graph.nodes.filter((node) => node.kind === 'route')
    const dbNodes = graph.nodes.filter((node) => node.kind === 'db')
    const httpNodes = graph.nodes.filter((node) => node.kind === 'http')

    expect(routeNodes).toHaveLength(2)
    expect(routeNodes.map((node) => node.label)).toEqual(
      expect.arrayContaining(['GET /api/users/:id', 'POST /api/orders'])
    )
    expect(dbNodes).toHaveLength(1)
    expect(dbNodes[0]?.label).toContain('postgresql')
    expect(dbNodes[0]?.label).toContain('appdb')
    expect(httpNodes).toHaveLength(1)
    expect(httpNodes[0]?.label).toBe('127.0.0.1:9999')

    const usersRouteId = routeNodes.find((node) => node.label === 'GET /api/users/:id')?.id
    const ordersRouteId = routeNodes.find((node) => node.label === 'POST /api/orders')?.id
    const dbNodeId = dbNodes[0]?.id
    const httpNodeId = httpNodes[0]?.id

    const usersToDbEdge = graph.edges.find((edge) => edge.from === usersRouteId && edge.to === dbNodeId)
    expect(usersToDbEdge?.count).toBe(2)
    expect(usersToDbEdge?.p95Ms).toBeGreaterThanOrEqual(4)

    const usersToHttpEdge = graph.edges.find((edge) => edge.from === usersRouteId && edge.to === httpNodeId)
    expect(usersToHttpEdge?.count).toBe(1)
    expect(usersToHttpEdge?.p95Ms).toBe(6)

    const ordersToDbEdge = graph.edges.find((edge) => edge.from === ordersRouteId && edge.to === dbNodeId)
    expect(ordersToDbEdge?.count).toBe(1)
    expect(ordersToDbEdge?.p95Ms).toBe(5)

    expect(graph.edges).toHaveLength(3)
  })

  it('ignores spans with no matched route pattern', () => {
    const spansWithChildren = [
      {
        span: span('s1', 'GET', null as unknown as string, 10),
        childSpans: [dbChild('c1', 's1', 4)]
      }
    ]
    const graph = buildDependencyGraph(spansWithChildren)
    expect(graph.nodes.filter((node) => node.kind === 'route')).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })

  it('returns an empty graph for no spans', () => {
    const graph = buildDependencyGraph([])
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })
})
