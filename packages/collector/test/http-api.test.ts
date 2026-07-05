import { afterEach, describe, expect, it } from 'vitest'
import { encodeWireMessage, PROTOCOL_VERSION } from '@apiscope/core'
import type { ChildSpan, DbChildSpan, RequestSpan } from '@apiscope/core'
import { createCollector, type Collector } from '../src/index'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

async function startCollector() {
  collector = createCollector({ dbPath: ':memory:', port: 0 })
  const address = await collector.listen()
  return `http://127.0.0.1:${address.port}`
}

const sampleSpan: RequestSpan = {
  id: 'h1',
  traceId: 't1',
  method: 'GET',
  routePattern: '/api/users',
  actualPath: '/api/users',
  statusCode: 200,
  timing: { start: 1, ttfb: 1, duration: 4 },
  framework: 'hono',
  runtime: 'edge'
}

describe('HTTP ingest and read APIs', () => {
  it('accepts handshake then span batches with the app header', async () => {
    const baseUrl = await startCollector()
    const handshakeResponse = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      body: encodeWireMessage({
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        app: { name: 'edge-app', framework: 'hono', runtime: 'edge' },
        routes: [{ method: 'GET', pattern: '/api/users' }]
      })
    })
    expect(handshakeResponse.status).toBe(202)
    const batchResponse = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'x-apiscope-app': 'edge-app' },
      body: encodeWireMessage({ type: 'span-batch', protocolVersion: PROTOCOL_VERSION, spans: [sampleSpan], childSpans: [], droppedCount: 0 })
    })
    expect(batchResponse.status).toBe(202)
    const spans = (await (await fetch(`${baseUrl}/api/spans?limit=10`)).json()) as RequestSpan[]
    expect(spans.map((span) => span.id)).toEqual(['h1'])
    const detail = await fetch(`${baseUrl}/api/spans/h1`)
    expect(detail.status).toBe(200)
    expect(((await detail.json()) as { span: RequestSpan }).span).toEqual(sampleSpan)
    const routes = (await (await fetch(`${baseUrl}/api/routes`)).json()) as unknown[]
    expect(routes).toHaveLength(1)
    const stats = (await (await fetch(`${baseUrl}/api/route-stats`)).json()) as Array<{ count: number }>
    expect(stats[0]?.count).toBe(1)
  })

  it('rejects batches without the app header', async () => {
    const baseUrl = await startCollector()
    const response = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      body: encodeWireMessage({ type: 'span-batch', protocolVersion: PROTOCOL_VERSION, spans: [], childSpans: [], droppedCount: 0 })
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { kind: 'missing-app' } })
  })

  it('rejects protocol version mismatches with details', async () => {
    const baseUrl = await startCollector()
    const response = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      body: JSON.stringify({ type: 'span-batch', protocolVersion: 99, spans: [], childSpans: [], droppedCount: 0 })
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { kind: 'version-mismatch', received: 99, supported: PROTOCOL_VERSION }
    })
  })

  it('returns 404 for unknown span ids', async () => {
    const baseUrl = await startCollector()
    const response = await fetch(`${baseUrl}/api/spans/missing`)
    expect(response.status).toBe(404)
  })

  it('filters spans by load-run id via query parameter', async () => {
    const baseUrl = await startCollector()
    await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      body: encodeWireMessage({
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        app: { name: 'edge-app', framework: 'hono', runtime: 'edge' },
        routes: []
      })
    })
    const taggedSpan: RequestSpan = { ...sampleSpan, id: 'tagged', loadRunId: 'run-1' }
    const untaggedSpan: RequestSpan = { ...sampleSpan, id: 'untagged' }
    await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'x-apiscope-app': 'edge-app' },
      body: encodeWireMessage({
        type: 'span-batch',
        protocolVersion: PROTOCOL_VERSION,
        spans: [taggedSpan, untaggedSpan],
        childSpans: [],
        droppedCount: 0
      })
    })
    const filtered = (await (await fetch(`${baseUrl}/api/spans?loadRunId=run-1`)).json()) as RequestSpan[]
    expect(filtered.map((span) => span.id)).toEqual(['tagged'])
    const unfiltered = (await (await fetch(`${baseUrl}/api/spans?limit=10`)).json()) as RequestSpan[]
    expect(unfiltered.map((span) => span.id).sort()).toEqual(['tagged', 'untagged'])
  })

  it('surfaces n+1 groups on span detail and a route indicator on the routes list', async () => {
    const baseUrl = await startCollector()
    await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      body: encodeWireMessage({
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        app: { name: 'n1-app', framework: 'express', runtime: 'node' },
        routes: [{ method: 'GET', pattern: '/api/posts' }]
      })
    })
    const nPlusOneSpan: RequestSpan = { ...sampleSpan, id: 'n1', method: 'GET', routePattern: '/api/posts', actualPath: '/api/posts' }
    const dbChildren: DbChildSpan[] = Array.from({ length: 6 }, (_, index) => ({
      id: `dbchild-${index}`,
      parentSpanId: 'n1',
      traceId: 't1',
      kind: 'db',
      system: 'postgresql',
      statement: `SELECT * FROM comments WHERE post_id = ${index}`,
      operation: 'SELECT',
      target: 'appdb',
      rowCount: 1,
      timing: { start: index, ttfb: null, duration: 1 }
    }))
    await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'x-apiscope-app': 'n1-app' },
      body: encodeWireMessage({
        type: 'span-batch',
        protocolVersion: PROTOCOL_VERSION,
        spans: [nPlusOneSpan],
        childSpans: dbChildren as ChildSpan[],
        droppedCount: 0
      })
    })
    const detail = (await (await fetch(`${baseUrl}/api/spans/n1`)).json()) as { nPlusOne: Array<{ count: number }> }
    expect(detail.nPlusOne).toHaveLength(1)
    expect(detail.nPlusOne[0]?.count).toBe(6)
    const routes = (await (await fetch(`${baseUrl}/api/routes`)).json()) as Array<{ pattern: string; nPlusOneRequests: number }>
    const postsRoute = routes.find((route) => route.pattern === '/api/posts')
    expect(postsRoute?.nPlusOneRequests).toBe(1)
  })

  it('exposes a dependency graph over recent spans and their children', async () => {
    const baseUrl = await startCollector()
    await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      body: encodeWireMessage({
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        app: { name: 'deps-app', framework: 'express', runtime: 'node' },
        routes: [{ method: 'GET', pattern: '/api/orders' }]
      })
    })
    const depsSpan: RequestSpan = { ...sampleSpan, id: 'deps1', method: 'GET', routePattern: '/api/orders', actualPath: '/api/orders' }
    const dbChild: DbChildSpan = {
      id: 'deps-db-1',
      parentSpanId: 'deps1',
      traceId: 't1',
      kind: 'db',
      system: 'postgresql',
      statement: 'SELECT * FROM orders WHERE id = ?',
      operation: 'SELECT',
      target: 'appdb',
      rowCount: 1,
      timing: { start: 0, ttfb: null, duration: 3 }
    }
    await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'x-apiscope-app': 'deps-app' },
      body: encodeWireMessage({
        type: 'span-batch',
        protocolVersion: PROTOCOL_VERSION,
        spans: [depsSpan],
        childSpans: [dbChild as ChildSpan],
        droppedCount: 0
      })
    })
    const graph = (await (await fetch(`${baseUrl}/api/dependencies`)).json()) as {
      nodes: Array<{ id: string; kind: string; label: string }>
      edges: Array<{ from: string; to: string; count: number; p95Ms: number }>
    }
    const routeNode = graph.nodes.find((node) => node.kind === 'route' && node.label === 'GET /api/orders')
    const dbNode = graph.nodes.find((node) => node.kind === 'db')
    expect(routeNode).toBeDefined()
    expect(dbNode?.label).toBe('postgresql appdb')
    const edge = graph.edges.find((entry) => entry.from === routeNode?.id && entry.to === dbNode?.id)
    expect(edge?.count).toBe(1)
    expect(edge?.p95Ms).toBe(3)
  })
})
