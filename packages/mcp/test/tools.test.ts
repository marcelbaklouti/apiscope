import { afterEach, describe, expect, it } from 'vitest'
import { createCollector, type Collector } from '@apiscope/collector'
import { createCollectorClient } from '../src/client'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

describe('mcp collector client', () => {
  it('lists routes and queries spans from a running collector', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    await collector.store.replaceRoutes('demo', [{ method: 'GET', pattern: '/users/:id' }])
    await collector.store.insertBatch('demo', {
      spans: [
        {
          id: '1',
          traceId: 't',
          method: 'GET',
          routePattern: '/users/:id',
          actualPath: '/users/1',
          statusCode: 200,
          timing: { start: 1, ttfb: null, duration: 5 },
          framework: 'express',
          runtime: 'node'
        }
      ],
      childSpans: []
    })
    const client = createCollectorClient(`http://127.0.0.1:${port}`)
    const routes = await client.listRoutes()
    expect(routes.some((route) => (route as { pattern: string }).pattern === '/users/:id')).toBe(true)
    const spans = await client.querySpans({ limit: 10 })
    expect(spans.length).toBeGreaterThan(0)
  })
})
