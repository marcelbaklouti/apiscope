import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '../src/index'
import { CollectorTransport, AdapterRuntime } from '@apiscope/adapter-node'

let collector: Collector
let target: Server | undefined

afterEach(async () => {
  await collector.close()
  if (target?.listening) await new Promise<void>((resolve) => target.close(() => resolve()))
})

describe('metrics endpoint', () => {
  it('exposes ingest counters after spans arrive', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${port}`,
      app: { name: 'metrics-app', framework: 'express', runtime: 'node' }
    })
    const runtime = new AdapterRuntime({ appName: 'metrics-app', framework: 'express', transport })
    runtime.start()
    runtime.recordSpan({
      id: 's1',
      traceId: 't',
      method: 'GET',
      routePattern: '/x',
      actualPath: '/x',
      statusCode: 200,
      timing: { start: 1, ttfb: null, duration: 5 },
      framework: 'express',
      runtime: 'node'
    })
    await vi.waitFor(async () => {
      const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text()
      expect(body).toContain('apiscope_ingested_spans_total')
      expect(body).toContain('metrics-app')
    }, { timeout: 3000 })
    await runtime.shutdown()
  })

  it('serves metrics without dashboard auth', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${port}/metrics`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
  })
})
