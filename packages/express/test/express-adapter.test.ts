import express from 'express'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '@apiscope/collector'
import { AdapterRuntime, CollectorTransport } from '@apiscope/adapter-node'
import { apiscopeExpress, extractExpressRoutes } from '../src/index'

let collector: Collector
let appServer: Server
let runtime: AdapterRuntime

afterEach(async () => {
  await runtime.shutdown()
  await new Promise<void>((resolve) => appServer.close(() => resolve()))
  await collector.close()
})

async function startStack() {
  collector = createCollector({ dbPath: ':memory:', port: 0 })
  const collectorAddress = await collector.listen()
  const transport = new CollectorTransport({
    collectorUrl: `ws://127.0.0.1:${collectorAddress.port}`,
    app: { name: 'express-demo', framework: 'express', runtime: 'node', pid: process.pid }
  })
  runtime = new AdapterRuntime({ appName: 'express-demo', framework: 'express', transport, capture: 'full' })
  const app = express()
  app.use(apiscopeExpress({ appName: 'express-demo', runtime }))
  app.get('/users/:id', (request, response) => response.json({ id: request.params.id }))
  const api = express.Router()
  api.post('/orders', (request, response) => response.status(201).json({ created: true }))
  app.use('/api', api)
  app.get('/fail', () => {
    throw new Error('handler exploded')
  })
  appServer = createServer(app)
  await new Promise<void>((resolve) => appServer.listen(0, '127.0.0.1', resolve))
  const address = appServer.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return { app, baseUrl: `http://127.0.0.1:${address.port}` }
}

describe('apiscopeExpress', () => {
  it('extracts nested routes', async () => {
    const { app } = await startStack()
    const routes = extractExpressRoutes(app)
    expect(routes).toContainEqual({ method: 'GET', pattern: '/users/:id' })
    expect(routes).toContainEqual({ method: 'POST', pattern: '/api/orders' })
  })

  it('records spans with route pattern, status and payloads end to end', async () => {
    const { baseUrl } = await startStack()
    const response = await fetch(`${baseUrl}/users/42`, { headers: { authorization: 'Bearer secret' } })
    expect(response.status).toBe(200)
    await vi.waitFor(
      () => {
        const spans = collector.store.recentSpans(10)
        expect(spans).toHaveLength(1)
      },
      { timeout: 2000 }
    )
    const span = collector.store.recentSpans(10)[0]!
    expect(span.routePattern).toBe('/users/:id')
    expect(span.actualPath).toBe('/users/42')
    expect(span.statusCode).toBe(200)
    expect(span.method).toBe('GET')
    expect(span.timing.duration).toBeGreaterThan(0)
    expect(span.timing.ttfb).not.toBeNull()
    expect(span.request?.headers['authorization']).toBe('[redacted]')
    expect(span.response?.body).toBe('{"id":"42"}')
  })

  it('records error spans with status 500', async () => {
    const { baseUrl } = await startStack()
    const response = await fetch(`${baseUrl}/fail`)
    expect(response.status).toBe(500)
    await vi.waitFor(
      () => expect(collector.store.recentSpans(10).some((span) => span.statusCode === 500)).toBe(true),
      { timeout: 2000 }
    )
  })

  it('pushes the route registry to the collector', async () => {
    const { baseUrl } = await startStack()
    await fetch(`${baseUrl}/users/1`)
    await vi.waitFor(
      () => expect(collector.store.listRoutes().length).toBeGreaterThanOrEqual(2),
      { timeout: 2000 }
    )
  })
})
