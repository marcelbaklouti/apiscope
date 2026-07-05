import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { PROTOCOL_VERSION } from '@apiscope/core'
import type { RequestSpan } from '@apiscope/core'
import { CollectorTransport } from '../src/transport'

interface ReceivedMessage {
  type: string
  [key: string]: unknown
}

async function createFakeCollector() {
  const received: ReceivedMessage[] = []
  const waiters: Array<() => void> = []
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      received.push(JSON.parse(String(data)) as ReceivedMessage)
      socket.send(JSON.stringify({ accepted: true }))
      for (const waiter of waiters.splice(0)) waiter()
    })
  })
  return {
    server,
    received,
    url() {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('no address')
      return `ws://127.0.0.1:${address.port}`
    },
    waitForMessages(count: number) {
      return new Promise<void>((resolve) => {
        const check = () => {
          if (received.length >= count) resolve()
          else waiters.push(check)
        }
        check()
      })
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

const app = { name: 'demo', framework: 'express', runtime: 'node' as const }

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

let transport: CollectorTransport
let fake: Awaited<ReturnType<typeof createFakeCollector>>

afterEach(async () => {
  await transport.stop()
  await fake.close()
})

describe('CollectorTransport', () => {
  it('sends handshake with routes on connect and registry updates afterwards', async () => {
    fake = await createFakeCollector()
    transport = new CollectorTransport({ collectorUrl: fake.url(), app })
    transport.setRoutes([{ method: 'GET', pattern: '/x' }])
    transport.start()
    await fake.waitForMessages(1)
    expect(fake.received[0]).toEqual({
      type: 'handshake',
      protocolVersion: PROTOCOL_VERSION,
      app,
      routes: [{ method: 'GET', pattern: '/x' }]
    })
    transport.setRoutes([{ method: 'GET', pattern: '/y' }])
    await fake.waitForMessages(2)
    expect(fake.received[1]).toEqual({
      type: 'registry-update',
      protocolVersion: PROTOCOL_VERSION,
      routes: [{ method: 'GET', pattern: '/y' }]
    })
  })

  it('delivers batches when connected', async () => {
    fake = await createFakeCollector()
    transport = new CollectorTransport({ collectorUrl: fake.url(), app })
    transport.start()
    await fake.waitForMessages(1)
    transport.sendBatch({ spans: [span('a')], childSpans: [], droppedCount: 0 })
    await fake.waitForMessages(2)
    expect(fake.received[1]?.type).toBe('span-batch')
    expect((fake.received[1] as unknown as { spans: RequestSpan[] }).spans[0]?.id).toBe('a')
  })

  it('counts spans discarded while disconnected into the next droppedCount', async () => {
    fake = await createFakeCollector()
    transport = new CollectorTransport({ collectorUrl: fake.url(), app, reconnectDelayMs: 50 })
    transport.sendBatch({ spans: [span('lost1'), span('lost2')], childSpans: [], droppedCount: 1 })
    transport.start()
    await fake.waitForMessages(1)
    transport.sendBatch({ spans: [span('kept')], childSpans: [], droppedCount: 0 })
    await fake.waitForMessages(2)
    expect(fake.received[1]).toMatchObject({ type: 'span-batch', droppedCount: 3 })
    expect((fake.received[1] as unknown as { spans: RequestSpan[] }).spans.map((entry) => entry.id)).toEqual(['kept'])
  })

  it('reconnects and repeats the handshake', async () => {
    fake = await createFakeCollector()
    transport = new CollectorTransport({ collectorUrl: fake.url(), app, reconnectDelayMs: 50 })
    transport.start()
    await fake.waitForMessages(1)
    for (const client of fake.server.clients) client.terminate()
    await fake.waitForMessages(2)
    expect(fake.received[1]?.type).toBe('handshake')
  })
})
