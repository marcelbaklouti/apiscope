import { afterEach, describe, expect, it } from 'vitest'
import { encodeWireMessage, PROTOCOL_VERSION } from '@apiscope/core'
import type { RequestSpan } from '@apiscope/core'
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
})
