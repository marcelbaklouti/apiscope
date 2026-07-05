import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { createCollector, type Collector } from '@apiscope/collector'
import { AdapterRuntime, CollectorTransport, instrumentDatabases } from '../src/index'

let container: StartedMongoDBContainer
let collector: Collector | undefined
let runtime: AdapterRuntime | undefined

beforeAll(async () => {
  container = await new MongoDBContainer('mongo:7').start()
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

describe('mongodb instrumentation', () => {
  it('captures a command as a db child span under the request span', async () => {
    instrumentDatabases()
    const { MongoClient } = await import('mongodb')
    const client = new MongoClient(container.getConnectionString(), { directConnection: true })
    await client.connect()
    const db = client.db('apiscope-test')

    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port: collectorPort } = await collector.listen()
    const transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${collectorPort}`,
      app: { name: 'mongo-app', framework: 'express', runtime: 'node' }
    })
    runtime = new AdapterRuntime({ appName: 'mongo-app', framework: 'express', transport })
    runtime.start()

    const context = runtime.newIds()
    await runtime.runWithSpan(context, async () => {
      await db.collection('users').insertOne({ name: 'ada' })
      await db.collection('users').find({ name: 'ada' }).toArray()
      runtime!.recordSpan({
        id: context.spanId,
        traceId: context.traceId,
        method: 'GET',
        routePattern: '/users',
        actualPath: '/users',
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
      const dbChildren = detail?.childSpans.filter((child) => child.kind === 'db') ?? []
      expect(dbChildren.length).toBeGreaterThanOrEqual(2)
    })

    const spans = await collector.store.recentSpans(10)
    const detail = await collector.store.spanById(spans[0]!.id)
    const dbChildren = detail!.childSpans.filter((child) => child.kind === 'db')
    const operations = dbChildren.map((child) => child.kind === 'db' && child.operation)
    expect(operations).toContain('insert')
    expect(operations).toContain('find')
    const insertChild = dbChildren.find((child) => child.kind === 'db' && child.operation === 'insert')
    expect(insertChild?.kind === 'db' && insertChild.system).toBe('mongodb')
    expect(insertChild?.kind === 'db' && insertChild.target).toBe('apiscope-test')

    await client.close()
  }, 60000)
})
