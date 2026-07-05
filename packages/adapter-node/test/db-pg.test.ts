import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createServer, type Server } from 'node:http'
import { AdapterRuntime, CollectorTransport, instrumentDatabases } from '../src/index'
import { createCollector, type Collector } from '@apiscope/collector'

let container: StartedPostgreSqlContainer
let collector: Collector
let app: Server

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start()
}, 120000)

afterAll(async () => {
  await container.stop()
})

describe('pg instrumentation', () => {
  it('captures a query as a db child span under the request span', async () => {
    instrumentDatabases()
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: container.getConnectionUri() })
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port: collectorPort } = await collector.listen()
    const transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${collectorPort}`,
      app: { name: 'pg-app', framework: 'express', runtime: 'node' }
    })
    const runtime = new AdapterRuntime({ appName: 'pg-app', framework: 'express', transport })
    runtime.start()

    app = createServer((request, response) => {
      const context = runtime.newIds()
      runtime.runWithSpan(context, async () => {
        await pool.query('SELECT 1 AS value')
        runtime.recordSpan({
          id: context.spanId,
          traceId: context.traceId,
          method: 'GET',
          routePattern: '/q',
          actualPath: '/q',
          statusCode: 200,
          timing: { start: Date.now(), ttfb: null, duration: 1 },
          framework: 'express',
          runtime: 'node'
        })
        response.end('ok')
      })
    })
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
    const { port } = app.address() as { port: number }
    await fetch(`http://127.0.0.1:${port}/q`)

    await vi.waitFor(
      async () => {
        const spans = await collector.store.recentSpans(10)
        expect(spans.length).toBeGreaterThan(0)
        const detail = await collector.store.spanById(spans[0]!.id)
        expect(detail?.childSpans.some((child) => child.kind === 'db')).toBe(true)
      },
      { timeout: 4000 }
    )

    const spans = await collector.store.recentSpans(10)
    const detail = await collector.store.spanById(spans[0]!.id)
    const dbChild = detail!.childSpans.find((child) => child.kind === 'db')!
    expect(dbChild.kind === 'db' && dbChild.system).toBe('postgresql')
    expect(dbChild.kind === 'db' && dbChild.operation).toBe('SELECT')

    await pool.end()
    await runtime.shutdown()
    await collector.close()
    await new Promise<void>((resolve) => app.close(() => resolve()))
  }, 60000)
})
