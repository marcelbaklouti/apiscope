import { describe, expect, it, vi } from 'vitest'
import { encodeWireMessage, PROTOCOL_VERSION } from '@apiscope/core'
import type { RequestSpan } from '@apiscope/core'
import { IngestProcessor } from '../src/ingest'
import { LiveHub } from '../src/live-hub'
import { SqliteSpanStore } from '../src/store'

const sampleSpan: RequestSpan = {
  id: 's1',
  traceId: 't1',
  method: 'GET',
  routePattern: '/health',
  actualPath: '/health',
  statusCode: 200,
  timing: { start: 1, ttfb: null, duration: 2 },
  framework: 'hono',
  runtime: 'edge'
}

function setup() {
  const store = new SqliteSpanStore(':memory:')
  const hub = new LiveHub()
  const events: unknown[] = []
  hub.subscribe((event) => events.push(event))
  return { processor: new IngestProcessor(store, hub), store, events }
}

describe('IngestProcessor', () => {
  it('registers app and routes on handshake and publishes events', async () => {
    const { processor, store, events } = setup()
    const session = { appName: null as string | null }
    const result = await processor.process(
      encodeWireMessage({
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        app: { name: 'demo', framework: 'hono', runtime: 'edge' },
        routes: [{ method: 'GET', pattern: '/health' }]
      }),
      session
    )
    expect(result).toEqual({ ok: true, appName: 'demo' })
    expect(session.appName).toBe('demo')
    expect(await store.listRoutes()).toHaveLength(1)
    expect(events).toEqual([
      { type: 'app-connected', app: { name: 'demo', framework: 'hono', runtime: 'edge' } },
      { type: 'registry', appName: 'demo', routes: [{ method: 'GET', pattern: '/health' }] }
    ])
  })

  it('persists span batches and publishes spans plus dropped events', async () => {
    const { processor, store, events } = setup()
    const session = { appName: 'demo' as string | null }
    const result = await processor.process(
      encodeWireMessage({
        type: 'span-batch',
        protocolVersion: PROTOCOL_VERSION,
        spans: [sampleSpan],
        childSpans: [],
        droppedCount: 3
      }),
      session
    )
    expect(result).toEqual({ ok: true, appName: 'demo' })
    expect(await store.spanById('s1')).not.toBeNull()
    expect(events).toEqual([
      { type: 'spans', appName: 'demo', spans: [sampleSpan], childSpans: [] },
      { type: 'dropped', appName: 'demo', droppedCount: 3 }
    ])
  })

  it('rejects span batches without a session app', async () => {
    const { processor } = setup()
    const result = await processor.process(
      encodeWireMessage({ type: 'span-batch', protocolVersion: PROTOCOL_VERSION, spans: [], childSpans: [], droppedCount: 0 }),
      { appName: null }
    )
    expect(result).toEqual({ ok: false, error: { kind: 'missing-app' } })
  })

  it('propagates decode errors without touching the store', async () => {
    const { processor, store } = setup()
    const result = await processor.process('{broken', { appName: 'demo' })
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-json' } })
    expect(await store.recentSpans(10)).toEqual([])
  })

  it('unsubscribing a live listener stops delivery', () => {
    const hub = new LiveHub()
    const listener = vi.fn()
    const unsubscribe = hub.subscribe(listener)
    unsubscribe()
    hub.publish({ type: 'app-disconnected', appName: 'demo' })
    expect(listener).not.toHaveBeenCalled()
  })
})
