import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createCollector, type Collector } from '@apiscope/collector'
import { AdapterRuntime, CollectorTransport, instrumentDatabases } from '../src/index'

let container: StartedMySqlContainer
let collector: Collector | undefined
let runtime: AdapterRuntime | undefined

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8').start()
}, 120000)

afterAll(async () => {
  await container.stop()
})

afterEach(async () => {
  if (runtime !== undefined) await runtime.shutdown()
  if (collector !== undefined) await collector.close()
  collector = undefined
  runtime = undefined
})

describe('mysql2 instrumentation', () => {
  it('captures a promise-style query as a db child span under the request span', async () => {
    instrumentDatabases()
    const mysql = await import('mysql2/promise')
    const connection = await mysql.createConnection(container.getConnectionUri())

    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port: collectorPort } = await collector.listen()
    const transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${collectorPort}`,
      app: { name: 'mysql-app', framework: 'express', runtime: 'node' }
    })
    runtime = new AdapterRuntime({ appName: 'mysql-app', framework: 'express', transport })
    runtime.start()

    const context = runtime.newIds()
    await runtime.runWithSpan(context, async () => {
      await connection.query('SELECT 1 AS value')
      runtime!.recordSpan({
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
    })

    await vi.waitFor(async () => {
      const spans = await collector!.store.recentSpans(10)
      expect(spans.length).toBeGreaterThan(0)
      const detail = await collector!.store.spanById(spans[0]!.id)
      expect(detail?.childSpans.some((child) => child.kind === 'db')).toBe(true)
    })

    const spans = await collector.store.recentSpans(10)
    const detail = await collector.store.spanById(spans[0]!.id)
    const dbChild = detail!.childSpans.find((child) => child.kind === 'db')!
    expect(dbChild.kind === 'db' && dbChild.system).toBe('mysql')
    expect(dbChild.kind === 'db' && dbChild.operation).toBe('SELECT')

    await connection.end()
  }, 60000)

  it('captures a callback-style query as a db child span under the request span', async () => {
    instrumentDatabases()
    const mysql = await import('mysql2')
    const connection = mysql.createConnection(container.getConnectionUri())

    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port: collectorPort } = await collector.listen()
    const transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${collectorPort}`,
      app: { name: 'mysql-callback-app', framework: 'express', runtime: 'node' }
    })
    runtime = new AdapterRuntime({ appName: 'mysql-callback-app', framework: 'express', transport })
    runtime.start()

    const context = runtime.newIds()
    await runtime.runWithSpan(context, async () => {
      await new Promise<void>((resolve, reject) => {
        connection.query('SELECT 2 AS value', (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      runtime!.recordSpan({
        id: context.spanId,
        traceId: context.traceId,
        method: 'GET',
        routePattern: '/q2',
        actualPath: '/q2',
        statusCode: 200,
        timing: { start: Date.now(), ttfb: null, duration: 1 },
        framework: 'express',
        runtime: 'node'
      })
    })

    await vi.waitFor(async () => {
      const spans = await collector!.store.recentSpans(10)
      expect(spans.length).toBeGreaterThan(0)
      const detail = await collector!.store.spanById(spans[0]!.id)
      expect(detail?.childSpans.some((child) => child.kind === 'db')).toBe(true)
    })

    const spans = await collector.store.recentSpans(10)
    const detail = await collector.store.spanById(spans[0]!.id)
    const dbChild = detail!.childSpans.find((child) => child.kind === 'db')!
    expect(dbChild.kind === 'db' && dbChild.system).toBe('mysql')

    await new Promise<void>((resolve) => connection.end(() => resolve()))
  }, 60000)
})
