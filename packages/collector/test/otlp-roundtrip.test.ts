import { AdapterRuntime, CollectorTransport } from '@apiscope/adapter-node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '../src/index'

let collectorA: Collector
let collectorB: Collector
let runtime: AdapterRuntime

afterEach(async () => {
  await runtime?.shutdown()
  await collectorB?.close()
  await collectorA?.close()
})

describe('otlp export/receiver interop', () => {
  it('exports a native span from collector B and receives it into collector A over otlp http/json', async () => {
    collectorA = createCollector({ dbPath: ':memory:', port: 0, otlpIngest: { http: true, appName: 'from-b' } })
    const addressA = await collectorA.listen()
    collectorB = createCollector({
      dbPath: ':memory:',
      port: 0,
      otlpExport: { endpoint: `http://127.0.0.1:${addressA.port}`, protocol: 'http/json', serviceName: 'from-b' }
    })
    const addressB = await collectorB.listen()
    const transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${addressB.port}`,
      app: { name: 'roundtrip-app', framework: 'express', runtime: 'node' }
    })
    runtime = new AdapterRuntime({ appName: 'roundtrip-app', framework: 'express', transport })
    runtime.start()
    runtime.recordSpan({
      id: 'aaaaaaaaaaaaaaaa',
      traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      method: 'GET',
      routePattern: '/interop',
      actualPath: '/interop',
      statusCode: 200,
      timing: { start: Date.now(), ttfb: null, duration: 8 },
      framework: 'express',
      runtime: 'node'
    })
    await vi.waitFor(
      async () => {
        const spans = await collectorA.store.recentSpans(10)
        expect(spans.length).toBe(1)
      },
      { timeout: 3000 }
    )
    const stored = (await collectorA.store.recentSpans(10))[0]!
    expect(stored.routePattern).toBe('/interop')
    expect(stored.method).toBe('GET')
    expect(stored.statusCode).toBe(200)
  })
})
