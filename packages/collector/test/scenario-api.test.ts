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

function span(id: string, method: string, route: string, path: string, startMs: number, duration: number): RequestSpan {
  return {
    id,
    traceId: `trace-${id}`,
    method,
    routePattern: route,
    actualPath: path,
    statusCode: 200,
    timing: { start: startMs, ttfb: null, duration },
    framework: 'express',
    runtime: 'node'
  }
}

describe('GET /api/scenario', () => {
  it('generates a scenario from ingested spans with a positive rps', async () => {
    const baseUrl = await startCollector()
    await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      body: encodeWireMessage({
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        app: { name: 'traffic-app', framework: 'express', runtime: 'node' },
        routes: [{ method: 'GET', pattern: '/users/:id' }]
      })
    })
    const now = Date.now()
    const spans: RequestSpan[] = []
    for (let index = 0; index < 20; index += 1) spans.push(span(`s${index}`, 'GET', '/users/:id', `/users/${index}`, now - 10000 + index * 100, 12))
    await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'x-apiscope-app': 'traffic-app' },
      body: encodeWireMessage({ type: 'span-batch', protocolVersion: PROTOCOL_VERSION, spans, childSpans: [], droppedCount: 0 })
    })
    const response = await fetch(`${baseUrl}/api/scenario?baseUrl=${encodeURIComponent('http://x')}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      scenario: { targets: Array<{ method: string; path: string }>; model: { kind: string; phases: Array<{ rps: number }> } }
      observed: { totalRequests: number }
    }
    expect(body.observed.totalRequests).toBe(20)
    expect(body.scenario.targets.length).toBe(1)
    expect(body.scenario.model.kind).toBe('open')
    expect(body.scenario.model.phases[0]?.rps).toBeGreaterThan(0)
  })

  it('returns an empty scenario when no spans are within the window', async () => {
    const baseUrl = await startCollector()
    const response = await fetch(`${baseUrl}/api/scenario?baseUrl=${encodeURIComponent('http://x')}&windowMs=1`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { scenario: { targets: unknown[] }; observed: { totalRequests: number } }
    expect(body.observed.totalRequests).toBe(0)
    expect(body.scenario.targets).toEqual([])
  })
})
