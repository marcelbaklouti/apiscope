import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '../src/index'
import { spansToExportRequest } from '../src/otlp/mapping'
import { encodeExportRequest } from '../src/otlp/proto'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

const request = spansToExportRequest(
  [
    {
      id: 'aaaaaaaaaaaaaaaa',
      traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      method: 'GET',
      routePattern: '/imported',
      actualPath: '/imported',
      statusCode: 200,
      timing: { start: 1_700_000_000_000, ttfb: null, duration: 7 },
      framework: 'otlp',
      runtime: 'node'
    }
  ],
  [],
  { serviceName: 'external-service' }
)

describe('otlp http receiver', () => {
  it('ingests json OTLP traces into the store under the resource service name', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, otlpIngest: { http: true } })
    const { port } = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    })
    expect(response.status).toBe(200)
    await vi.waitFor(async () => expect((await collector.store.recentSpans(10)).length).toBe(1), { timeout: 2000 })
    const stored = (await collector.store.recentSpans(10))[0]!
    expect(stored.routePattern).toBe('/imported')
    const routes = await collector.store.listRoutes()
    void routes
  })

  it('ingests protobuf OTLP traces', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, otlpIngest: { http: true } })
    const { port } = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeExportRequest(request) as BodyInit
    })
    expect(response.status).toBe(200)
    await vi.waitFor(async () => expect((await collector.store.recentSpans(10)).length).toBe(1), { timeout: 2000 })
  })

  it('returns 404 for /v1/traces when otlp ingest is disabled', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(404)
  })
})
