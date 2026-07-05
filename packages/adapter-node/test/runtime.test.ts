import { describe, expect, it, vi } from 'vitest'
import type { RequestSpan, SpanBatchPayload } from '@apiscope/core'
import { AdapterRuntime } from '../src/runtime'
import type { CollectorTransport } from '../src/transport'

function fakeTransport() {
  const batches: SpanBatchPayload[] = []
  const transport = {
    start: vi.fn(),
    setRoutes: vi.fn(),
    sendBatch: (batch: SpanBatchPayload) => batches.push(batch),
    stop: vi.fn(async () => {})
  } as unknown as CollectorTransport
  return { transport, batches }
}

function span(id: string): RequestSpan {
  return {
    id,
    traceId: 't',
    method: 'GET',
    routePattern: '/x',
    actualPath: '/x',
    statusCode: 200,
    timing: { start: 1, ttfb: null, duration: 1 },
    framework: 'express',
    runtime: 'node'
  }
}

describe('AdapterRuntime', () => {
  it('flushes recorded spans through the transport on shutdown', async () => {
    const { transport, batches } = fakeTransport()
    const runtime = new AdapterRuntime({ appName: 'demo', framework: 'express', transport })
    runtime.start()
    runtime.recordSpan(span('a'))
    await runtime.shutdown()
    expect(batches).toHaveLength(1)
    expect(batches[0]?.spans[0]?.id).toBe('a')
  })

  it('tracks the active span context across async boundaries', async () => {
    const { transport } = fakeTransport()
    const runtime = new AdapterRuntime({ appName: 'demo', framework: 'express', transport })
    const context = runtime.newIds()
    const observed = await runtime.runWithSpan(context, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return runtime.currentSpan()
    })
    expect(observed).toEqual(context)
    expect(runtime.currentSpan()).toBeNull()
    await runtime.shutdown()
  })

  it('generates unique ids', async () => {
    const { transport } = fakeTransport()
    const runtime = new AdapterRuntime({ appName: 'demo', framework: 'express', transport })
    const first = runtime.newIds()
    const second = runtime.newIds()
    expect(first.spanId).not.toBe(second.spanId)
    expect(first.traceId).not.toBe(second.traceId)
    await runtime.shutdown()
  })

  it('applies capture levels', async () => {
    const { transport } = fakeTransport()
    const none = new AdapterRuntime({ appName: 'demo', framework: 'express', transport, capture: 'none' })
    expect(none.capturePayload({ a: 'b' }, 'body')).toBeUndefined()
    const headersOnly = new AdapterRuntime({ appName: 'demo', framework: 'express', transport })
    expect(headersOnly.capturePayload({ Authorization: 'x' }, 'body')).toEqual({
      headers: { Authorization: '[redacted]' },
      truncated: false,
      redactedHeaders: ['authorization']
    })
    const full = new AdapterRuntime({ appName: 'demo', framework: 'express', transport, capture: 'full' })
    expect(full.capturePayload({}, 'body')?.body).toBe('body')
    await none.shutdown()
    await headersOnly.shutdown()
    await full.shutdown()
  })
})
