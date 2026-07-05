import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@apiscope/core'
import type { RequestSpan } from '@apiscope/core'
import { createCollector, type Collector } from '@apiscope/collector'
import { HttpCollectorTransport } from '../src/transport'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

function span(id: string): RequestSpan {
  return {
    id,
    traceId: 't',
    method: 'GET',
    routePattern: '/x',
    actualPath: '/x',
    statusCode: 200,
    timing: { start: 1, ttfb: null, duration: 1 },
    framework: 'hono',
    runtime: 'edge'
  }
}

describe('HttpCollectorTransport', () => {
  it('sends handshake exactly once and batches with the app header', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const transport = new HttpCollectorTransport({
      collectorUrl: `http://127.0.0.1:${port}`,
      app: { name: 'hono-demo', framework: 'hono', runtime: 'edge' }
    })
    await transport.ensureHandshake([{ method: 'GET', pattern: '/x' }])
    await transport.ensureHandshake([{ method: 'GET', pattern: '/x' }])
    await transport.sendBatch({ spans: [span('a')], childSpans: [], droppedCount: 0 })
    expect(await collector.store.listRoutes()).toHaveLength(1)
    expect(await collector.store.spanById('a')).not.toBeNull()
  })

  it('accumulates dropped counts across failed sends', async () => {
    const unreachable = new HttpCollectorTransport({
      collectorUrl: 'http://127.0.0.1:1',
      app: { name: 'hono-demo', framework: 'hono', runtime: 'edge' }
    })
    await unreachable.sendBatch({ spans: [span('lost1'), span('lost2')], childSpans: [], droppedCount: 0 })

    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const droppedEvents: unknown[] = []
    collector.hub.subscribe((event) => {
      if (event.type === 'dropped') droppedEvents.push(event)
    })
    Object.assign(unreachable, { ingestUrl: `http://127.0.0.1:${port}/ingest` })
    await unreachable.ensureHandshake([])
    await unreachable.sendBatch({ spans: [span('kept')], childSpans: [], droppedCount: 0 })
    expect(await collector.store.spanById('kept')).not.toBeNull()
    expect(droppedEvents).toEqual([{ type: 'dropped', appName: 'hono-demo', droppedCount: 2 }])
    expect(PROTOCOL_VERSION).toBe(1)
  })
})
