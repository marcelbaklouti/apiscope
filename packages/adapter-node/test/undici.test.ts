import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ChildSpan } from '@apiscope/core'
import { AdapterRuntime } from '../src/runtime'
import { subscribeUndici } from '../src/undici'
import type { CollectorTransport } from '../src/transport'

const targetServer = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('pong')
})

let targetUrl = ''

beforeAll(async () => {
  await new Promise<void>((resolve) => targetServer.listen(0, '127.0.0.1', resolve))
  const address = targetServer.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  targetUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => targetServer.close(() => resolve()))
})

function runtimeWithSink() {
  const childSpans: ChildSpan[] = []
  const transport = {
    start: vi.fn(),
    setRoutes: vi.fn(),
    sendBatch: vi.fn(),
    stop: vi.fn(async () => {})
  } as unknown as CollectorTransport
  const runtime = new AdapterRuntime({ appName: 'demo', framework: 'express', transport })
  const originalRecord = runtime.recordChildSpan.bind(runtime)
  runtime.recordChildSpan = (childSpan) => {
    childSpans.push(childSpan)
    originalRecord(childSpan)
  }
  return { runtime, childSpans }
}

describe('subscribeUndici', () => {
  it('captures fetches inside a span context as child spans', async () => {
    const { runtime, childSpans } = runtimeWithSink()
    const unsubscribe = subscribeUndici(runtime)
    const context = runtime.newIds()
    await runtime.runWithSpan(context, async () => {
      const response = await fetch(`${targetUrl}/ping`)
      await response.text()
    })
    await vi.waitFor(() => expect(childSpans).toHaveLength(1))
    const childSpan = childSpans[0]!
    if (childSpan.kind !== 'fetch') throw new Error('expected a fetch child span')
    expect(childSpan.parentSpanId).toBe(context.spanId)
    expect(childSpan.traceId).toBe(context.traceId)
    expect(childSpan.method).toBe('GET')
    expect(childSpan.url).toBe(`${targetUrl}/ping`)
    expect(childSpan.statusCode).toBe(200)
    expect(childSpan.timing.duration).toBeGreaterThan(0)
    unsubscribe()
    await runtime.shutdown()
  })

  it('ignores fetches outside a span context', async () => {
    const { runtime, childSpans } = runtimeWithSink()
    const unsubscribe = subscribeUndici(runtime)
    const response = await fetch(`${targetUrl}/ping`)
    await response.text()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(childSpans).toHaveLength(0)
    unsubscribe()
    await runtime.shutdown()
  })

  it('records errors for failed requests', async () => {
    const { runtime, childSpans } = runtimeWithSink()
    const unsubscribe = subscribeUndici(runtime)
    const context = runtime.newIds()
    await runtime.runWithSpan(context, async () => {
      await expect(fetch('http://127.0.0.1:65530/unreachable')).rejects.toThrow()
    })
    await vi.waitFor(() => expect(childSpans).toHaveLength(1))
    const errorChild = childSpans[0]!
    if (errorChild.kind !== 'fetch') throw new Error('expected a fetch child span')
    expect(errorChild.statusCode).toBeNull()
    expect(errorChild.error?.message).toBeTruthy()
    unsubscribe()
    await runtime.shutdown()
  })
})
