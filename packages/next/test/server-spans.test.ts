import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestSpan } from '@apiscope/core'
import { AdapterRuntime } from '@apiscope/adapter-node'
import type { CollectorTransport } from '@apiscope/adapter-node'
import { subscribeHttpServer } from '../src/server-spans'

let server: Server
let unsubscribe: () => void

afterEach(async () => {
  unsubscribe()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function runtimeWithSink() {
  const spans: RequestSpan[] = []
  const transport = {
    start: vi.fn(),
    setRoutes: vi.fn(),
    sendBatch: vi.fn(),
    stop: vi.fn(async () => {})
  } as unknown as CollectorTransport
  const runtime = new AdapterRuntime({ appName: 'next-demo', framework: 'next', transport })
  const originalRecord = runtime.recordSpan.bind(runtime)
  runtime.recordSpan = (span) => {
    spans.push(span)
    originalRecord(span)
  }
  return { runtime, spans }
}

async function startServer(): Promise<string> {
  server = createServer((request, response) => {
    if (request.url?.startsWith('/api/slow')) {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
      }, 20)
      return
    }
    response.writeHead(request.url?.includes('missing') ? 404 : 200)
    response.end('done')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return `http://127.0.0.1:${address.port}`
}

describe('subscribeHttpServer', () => {
  it('records spans with matched route patterns', async () => {
    const { runtime, spans } = runtimeWithSink()
    unsubscribe = subscribeHttpServer(runtime, () => ['/api/slow/:id'])
    const baseUrl = await startServer()
    await fetch(`${baseUrl}/api/slow/9?verbose=1`)
    await vi.waitFor(() => expect(spans).toHaveLength(1))
    const span = spans[0]!
    expect(span.routePattern).toBe('/api/slow/:id')
    expect(span.actualPath).toBe('/api/slow/9')
    expect(span.statusCode).toBe(200)
    expect(span.framework).toBe('next')
    expect(span.timing.duration).toBeGreaterThan(0)
    await runtime.shutdown()
  })

  it('records unmatched paths with null pattern and skips internal paths', async () => {
    const { runtime, spans } = runtimeWithSink()
    unsubscribe = subscribeHttpServer(runtime, () => [])
    const baseUrl = await startServer()
    await fetch(`${baseUrl}/_next/static/chunk.js`)
    await fetch(`${baseUrl}/favicon.ico`)
    await fetch(`${baseUrl}/api/missing`)
    await vi.waitFor(() => expect(spans).toHaveLength(1))
    expect(spans[0]?.routePattern).toBeNull()
    expect(spans[0]?.statusCode).toBe(404)
    await runtime.shutdown()
  })
})
