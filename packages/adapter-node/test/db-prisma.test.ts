import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '@apiscope/collector'
import { AdapterRuntime, CollectorTransport, instrumentDatabases } from '../src/index'
import { getPrismaSpanProcessor } from '../src/db/prisma'

let collector: Collector | undefined
let runtime: AdapterRuntime | undefined

afterEach(async () => {
  if (runtime !== undefined) await runtime.shutdown()
  if (collector !== undefined) await collector.close()
  collector = undefined
  runtime = undefined
})

function syntheticPrismaSpan(attributes: Record<string, unknown>): { attributes: Record<string, unknown>; startTime: [number, number]; duration: [number, number] } {
  return {
    attributes,
    startTime: [1_700_000_000, 0],
    duration: [0, 5_000_000]
  }
}

describe('prisma opentelemetry bridge', () => {
  it('attaches a db child span from a synthetic prisma readable span when a request span is active', async () => {
    instrumentDatabases()
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port: collectorPort } = await collector.listen()
    const transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${collectorPort}`,
      app: { name: 'prisma-app', framework: 'express', runtime: 'node' }
    })
    runtime = new AdapterRuntime({ appName: 'prisma-app', framework: 'express', transport })
    runtime.start()

    const processor = getPrismaSpanProcessor()
    expect(processor).not.toBeNull()

    const context = runtime.newIds()
    runtime.runWithSpan(context, () => {
      processor!.onEnd(
        syntheticPrismaSpan({
          'db.system': 'postgresql',
          'db.query.text': 'SELECT * FROM "User" WHERE "id" = $1',
          'db.namespace': 'appdb'
        })
      )
    })
    runtime.recordSpan({
      id: context.spanId,
      traceId: context.traceId,
      method: 'GET',
      routePattern: '/users',
      actualPath: '/users',
      statusCode: 200,
      timing: { start: Date.now(), ttfb: null, duration: 5 },
      framework: 'express',
      runtime: 'node'
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
    expect(dbChild).toBeDefined()
    expect(dbChild.kind === 'db' && dbChild.system).toBe('postgresql')
    expect(dbChild.kind === 'db' && dbChild.statement).toBe('SELECT * FROM "User" WHERE "id" = $1')
    expect(dbChild.kind === 'db' && dbChild.target).toBe('appdb')
  })

  it('ignores prisma engine spans without a db statement', async () => {
    instrumentDatabases()
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port: collectorPort } = await collector.listen()
    const transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${collectorPort}`,
      app: { name: 'prisma-nostmt-app', framework: 'express', runtime: 'node' }
    })
    runtime = new AdapterRuntime({ appName: 'prisma-nostmt-app', framework: 'express', transport })
    runtime.start()

    const processor = getPrismaSpanProcessor()!
    const context = runtime.newIds()
    runtime.runWithSpan(context, () => {
      processor.onEnd(syntheticPrismaSpan({ method: 'findMany' }))
    })
    runtime.recordSpan({
      id: context.spanId,
      traceId: context.traceId,
      method: 'GET',
      routePattern: '/users',
      actualPath: '/users',
      statusCode: 200,
      timing: { start: Date.now(), ttfb: null, duration: 5 },
      framework: 'express',
      runtime: 'node'
    })

    await vi.waitFor(async () => {
      const spans = await collector!.store.recentSpans(10)
      expect(spans.length).toBeGreaterThan(0)
    })

    const spans = await collector.store.recentSpans(10)
    const detail = await collector.store.spanById(spans[0]!.id)
    expect(detail!.childSpans.filter((child) => child.kind === 'db')).toHaveLength(0)
  })

  it('drops a prisma span when no request span is active', () => {
    instrumentDatabases()
    const processor = getPrismaSpanProcessor()!
    expect(() => processor.onEnd(syntheticPrismaSpan({ 'db.system': 'postgresql', 'db.query.text': 'SELECT 1' }))).not.toThrow()
  })
})
