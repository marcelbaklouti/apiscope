import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { encodeWireMessage, PROTOCOL_VERSION } from '@apiscope/core'
import type { RequestSpan } from '@apiscope/core'
import { createDashboardAuthenticator } from '../src/auth/dashboard-auth'
import { createTokenIngestAuthenticator } from '../src/auth/ingest-auth'
import { createSessionCodec } from '../src/auth/session'
import { createCollector, type Collector } from '../src/index'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

function connect(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, headers === undefined ? undefined : { headers })
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

function messageQueue(socket: WebSocket): { next(): Promise<unknown> } {
  const received: unknown[] = []
  const waiting: Array<(value: unknown) => void> = []
  socket.on('message', (data) => {
    const parsed = JSON.parse(String(data))
    const waiter = waiting.shift()
    if (waiter) waiter(parsed)
    else received.push(parsed)
  })
  return {
    next() {
      const queued = received.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      return new Promise((resolve) => waiting.push(resolve))
    }
  }
}

const sampleSpan: RequestSpan = {
  id: 'w1',
  traceId: 't1',
  method: 'GET',
  routePattern: '/ws-route',
  actualPath: '/ws-route',
  statusCode: 200,
  timing: { start: 1, ttfb: null, duration: 2 },
  framework: 'express',
  runtime: 'node'
}

describe('WebSocket ingest and live subscriptions', () => {
  it('streams adapter batches to live subscribers', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const live = await connect(`ws://127.0.0.1:${port}/ws/live`)
    const ingest = await connect(`ws://127.0.0.1:${port}/ws/ingest`)
    const liveMessages = messageQueue(live)
    const ingestMessages = messageQueue(ingest)

    ingest.send(
      encodeWireMessage({
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        app: { name: 'ws-app', framework: 'express', runtime: 'node' },
        routes: []
      })
    )
    expect(await ingestMessages.next()).toEqual({ accepted: true })
    expect(await liveMessages.next()).toEqual({
      type: 'app-connected',
      app: { name: 'ws-app', framework: 'express', runtime: 'node' }
    })
    expect(await liveMessages.next()).toEqual({ type: 'registry', appName: 'ws-app', routes: [] })

    ingest.send(
      encodeWireMessage({ type: 'span-batch', protocolVersion: PROTOCOL_VERSION, spans: [sampleSpan], childSpans: [], droppedCount: 0 })
    )
    expect(await ingestMessages.next()).toEqual({ accepted: true })
    expect(await liveMessages.next()).toEqual({ type: 'spans', appName: 'ws-app', spans: [sampleSpan], childSpans: [] })
    expect(await collector.store.spanById('w1')).not.toBeNull()

    ingest.close()
    expect(await liveMessages.next()).toEqual({ type: 'app-disconnected', appName: 'ws-app' })
    live.close()
  })

  it('answers invalid ingest messages with an error and keeps running', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const ingest = await connect(`ws://127.0.0.1:${port}/ws/ingest`)
    const ingestMessages = messageQueue(ingest)
    ingest.send('{broken')
    expect(await ingestMessages.next()).toEqual({ error: { kind: 'invalid-json' } })
    ingest.send(
      encodeWireMessage({ type: 'span-batch', protocolVersion: PROTOCOL_VERSION, spans: [], childSpans: [], droppedCount: 0 })
    )
    expect(await ingestMessages.next()).toEqual({ error: { kind: 'missing-app' } })
    ingest.close()
  })

  it('rejects websocket upgrades on unknown paths', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    await expect(connect(`ws://127.0.0.1:${port}/ws/unknown`)).rejects.toThrow()
  })

  it('refuses an unauthenticated ingest upgrade when a token authenticator is configured', async () => {
    const ingestAuth = createTokenIngestAuthenticator([{ appName: 'web', token: 'secret-token' }])
    collector = createCollector({ dbPath: ':memory:', port: 0, ingestAuth })
    const { port } = await collector.listen()
    await expect(connect(`ws://127.0.0.1:${port}/ws/ingest`)).rejects.toThrow()
  })

  it('refuses an unauthenticated /ws/live upgrade when dashboard auth requires a session', async () => {
    const sessionSecret = 'ws-live-guard-test-secret-value-abcdefgh'
    const dashboardAuth = await createDashboardAuthenticator({
      mode: 'password',
      sessionSecret,
      users: [{ username: 'u', passwordHash: 'unused', displayName: 'U' }]
    })
    collector = createCollector({ dbPath: ':memory:', port: 0, dashboardAuth })
    const { port } = await collector.listen()
    await expect(connect(`ws://127.0.0.1:${port}/ws/live`)).rejects.toThrow()
  })

  it('accepts a /ws/live upgrade carrying a valid dashboard session cookie', async () => {
    const sessionSecret = 'ws-live-guard-test-secret-value-abcdefgh'
    const dashboardAuth = await createDashboardAuthenticator({
      mode: 'password',
      sessionSecret,
      users: [{ username: 'u', passwordHash: 'unused', displayName: 'U' }]
    })
    collector = createCollector({ dbPath: ':memory:', port: 0, dashboardAuth })
    const { port } = await collector.listen()
    const codec = createSessionCodec(new TextEncoder().encode(sessionSecret))
    const token = await codec.issue({ subject: 'u', displayName: 'U' }, 3600)
    const live = await connect(`ws://127.0.0.1:${port}/ws/live`, { cookie: `apiscope_session=${token}` })
    live.close()
  })

  it('allows an unauthenticated /ws/live upgrade when dashboard auth is none', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const live = await connect(`ws://127.0.0.1:${port}/ws/live`)
    live.close()
  })
})
