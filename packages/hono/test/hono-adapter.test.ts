import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '@apiscope/collector'
import { apiscopeHono, detectRuntime } from '../src/index'

let collector: Collector
let collectorStarted = false
let shutdown: (() => Promise<void>) | null = null

afterEach(async () => {
  if (shutdown !== null) await shutdown()
  shutdown = null
  if (collectorStarted) await collector.close()
  collectorStarted = false
})

async function startStack(mode: 'batch' | 'immediate') {
  collector = createCollector({ dbPath: ':memory:', port: 0 })
  collectorStarted = true
  const { port } = await collector.listen()
  const app = new Hono()
  const adapter = apiscopeHono(app, {
    appName: 'hono-demo',
    collectorUrl: `http://127.0.0.1:${port}`,
    mode,
    capture: 'headers'
  })
  shutdown = adapter.shutdown
  app.get('/todos/:todoId', (c) => c.json({ todoId: c.req.param('todoId') }))
  app.post('/todos', (c) => c.json({ created: true }, 201))
  app.get('/explode', () => {
    throw new Error('hono handler failed')
  })
  return app
}

describe('apiscopeHono batch mode', () => {
  it('records spans with route patterns and pushes the registry', async () => {
    const app = await startStack('batch')
    const response = await app.request('http://localhost/todos/9', {
      headers: { authorization: 'Bearer secret' }
    })
    expect(response.status).toBe(200)
    if (shutdown !== null) await shutdown()
    shutdown = null
    await vi.waitFor(() => expect(collector.store.recentSpans(10)).toHaveLength(1), { timeout: 2000 })
    const span = collector.store.recentSpans(10)[0]!
    expect(span.routePattern).toBe('/todos/:todoId')
    expect(span.actualPath).toBe('/todos/9')
    expect(span.framework).toBe('hono')
    expect(span.request?.headers['authorization']).toBe('[redacted]')
    const routes = collector.store.listRoutes()
    expect(routes).toContainEqual({ appName: 'hono-demo', method: 'GET', pattern: '/todos/:todoId' })
    expect(routes).toContainEqual({ appName: 'hono-demo', method: 'POST', pattern: '/todos' })
    expect(routes.every((route) => route.method !== 'ALL')).toBe(true)
  })

  it('records error spans with status 500 and rethrows', async () => {
    const app = await startStack('batch')
    const response = await app.request('http://localhost/explode')
    expect(response.status).toBe(500)
    if (shutdown !== null) await shutdown()
    shutdown = null
    await vi.waitFor(
      () => {
        const span = collector.store.recentSpans(10).find((entry) => entry.statusCode === 500)
        expect(span?.error?.message).toBe('hono handler failed')
      },
      { timeout: 2000 }
    )
  })
})

describe('apiscopeHono immediate mode', () => {
  it('delivers via executionCtx.waitUntil without buffering', async () => {
    const app = await startStack('immediate')
    const backgroundWork: Promise<unknown>[] = []
    const executionCtx = {
      waitUntil: (promise: Promise<unknown>) => backgroundWork.push(promise),
      passThroughOnException: () => {}
    }
    const response = await app.request('http://localhost/todos/1', {}, {}, executionCtx as never)
    expect(response.status).toBe(200)
    expect(backgroundWork.length).toBeGreaterThan(0)
    await Promise.all(backgroundWork)
    expect(collector.store.recentSpans(10)).toHaveLength(1)
  })
})

describe('detectRuntime', () => {
  it('falls back to node in this test environment', () => {
    expect(detectRuntime()).toBe('node')
  })
})
