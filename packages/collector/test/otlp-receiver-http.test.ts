import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTokenIngestAuthenticator } from '../src/auth/ingest-auth'
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

  it('ingests under the authenticated app, not the client-declared service.name', async () => {
    const ingestAuth = createTokenIngestAuthenticator([{ appName: 'app-a', token: 'app-a-token' }])
    collector = createCollector({ dbPath: ':memory:', port: 0, ingestAuth, otlpIngest: { http: true } })
    const { port } = await collector.listen()
    const publishedAppNames: string[] = []
    collector.hub.subscribe((event) => {
      if (event.type === 'spans') publishedAppNames.push(event.appName)
    })
    const spoofingRequest = spansToExportRequest(
      [
        {
          id: 'cccccccccccccccc',
          traceId: 'dddddddddddddddddddddddddddddddd',
          method: 'GET',
          routePattern: '/spoofed',
          actualPath: '/spoofed',
          statusCode: 200,
          timing: { start: 1_700_000_000_000, ttfb: null, duration: 7 },
          framework: 'otlp',
          runtime: 'node'
        }
      ],
      [],
      { serviceName: 'app-b' }
    )
    const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer app-a-token' },
      body: JSON.stringify(spoofingRequest)
    })
    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(publishedAppNames).toEqual(['app-a']), { timeout: 2000 })
  })

  it('does not crash on an OTLP export carrying a non-numeric timestamp', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, otlpIngest: { http: true } })
    const { port } = await collector.listen()
    const malformed = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'evil' } }] },
          scopeSpans: [
            {
              scope: { name: 'apiscope' },
              spans: [
                {
                  traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  spanId: 'aaaaaaaaaaaaaaaa',
                  name: 'GET /x',
                  kind: 2,
                  startTimeUnixNano: 'not-a-number',
                  endTimeUnixNano: 'also-not-a-number',
                  attributes: [],
                  status: { code: 1 }
                }
              ]
            }
          ]
        }
      ]
    }
    const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(malformed)
    })
    expect(response.status).toBeLessThan(500)
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    expect(health.status).toBe(200)
  })

  it('rejects an oversized OTLP body with 413 and stays up', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, otlpIngest: { http: true }, maxRequestBytes: 1024 })
    const { port } = await collector.listen()
    const oversized = 'a'.repeat(4096)
    const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: oversized })
    })
    expect(response.status).toBe(413)
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    expect(health.status).toBe(200)
  })

  it('rejects an OTLP HTTP export with no token when a token authenticator is configured', async () => {
    const ingestAuth = createTokenIngestAuthenticator([{ appName: 'app-a', token: 'app-a-token' }])
    collector = createCollector({ dbPath: ':memory:', port: 0, ingestAuth, otlpIngest: { http: true } })
    const { port } = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    })
    expect(response.status).toBe(401)
  })
})
