import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '@apiscope/collector'
import { AdapterRuntime, CollectorTransport } from '@apiscope/adapter-node'
import { apiscopeFastify } from '../src/index'

let collector: Collector
let app: FastifyInstance
let runtime: AdapterRuntime

afterEach(async () => {
  await app.close()
  await runtime.shutdown()
  await collector.close()
})

async function startStack() {
  collector = createCollector({ dbPath: ':memory:', port: 0 })
  const collectorAddress = await collector.listen()
  const transport = new CollectorTransport({
    collectorUrl: `ws://127.0.0.1:${collectorAddress.port}`,
    app: { name: 'fastify-demo', framework: 'fastify', runtime: 'node', pid: process.pid }
  })
  runtime = new AdapterRuntime({ appName: 'fastify-demo', framework: 'fastify', transport })
  app = Fastify()
  await app.register(apiscopeFastify, { appName: 'fastify-demo', runtime })
  app.get('/items/:itemId', async (request) => ({ itemId: (request.params as { itemId: string }).itemId }))
  app.post('/items', async (request, reply) => reply.status(201).send({ created: true }))
  app.get('/broken', async () => {
    throw new Error('kaputt')
  })
  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' })
  return baseUrl
}

describe('apiscopeFastify', () => {
  it('records spans with fastify route patterns end to end', async () => {
    const baseUrl = await startStack()
    const response = await fetch(`${baseUrl}/items/7`)
    expect(response.status).toBe(200)
    await vi.waitFor(async () => expect(await collector.store.recentSpans(10)).toHaveLength(1), { timeout: 2000 })
    const span = (await collector.store.recentSpans(10))[0]!
    expect(span.routePattern).toBe('/items/:itemId')
    expect(span.actualPath).toBe('/items/7')
    expect(span.framework).toBe('fastify')
    expect(span.timing.duration).toBeGreaterThan(0)
  })

  it('records error spans with the thrown message', async () => {
    const baseUrl = await startStack()
    const response = await fetch(`${baseUrl}/broken`)
    expect(response.status).toBe(500)
    await vi.waitFor(
      async () => {
        const span = (await collector.store.recentSpans(10)).find((entry) => entry.statusCode === 500)
        expect(span?.error?.message).toBe('kaputt')
      },
      { timeout: 2000 }
    )
  })

  it('pushes the registry without HEAD duplicates', async () => {
    await startStack()
    await vi.waitFor(
      async () => {
        const routes = await collector.store.listRoutes()
        expect(routes).toContainEqual({ appName: 'fastify-demo', method: 'GET', pattern: '/items/:itemId' })
        expect(routes).toContainEqual({ appName: 'fastify-demo', method: 'POST', pattern: '/items' })
        expect(routes.every((route) => route.method !== 'HEAD')).toBe(true)
      },
      { timeout: 2000 }
    )
  })
})
