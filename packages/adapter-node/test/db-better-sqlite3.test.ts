import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createCollector, type Collector } from '@apiscope/collector'
import { AdapterRuntime, CollectorTransport, instrumentDatabases } from '../src/index'

let collector: Collector | undefined
let runtime: AdapterRuntime | undefined

afterEach(async () => {
  if (runtime !== undefined) await runtime.shutdown()
  if (collector !== undefined) await collector.close()
  collector = undefined
  runtime = undefined
})

describe('better-sqlite3 instrumentation', () => {
  it('captures a run, get and all as db child spans under the request span', async () => {
    instrumentDatabases()
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port: collectorPort } = await collector.listen()
    const transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${collectorPort}`,
      app: { name: 'sqlite-app', framework: 'express', runtime: 'node' }
    })
    runtime = new AdapterRuntime({ appName: 'sqlite-app', framework: 'express', transport })
    runtime.start()

    const db = new Database(':memory:')
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')

    const context = runtime.newIds()
    await runtime.runWithSpan(context, () => {
      db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(1, 'ada')
      db.prepare('SELECT * FROM users WHERE id = ?').get(1)
      db.prepare('SELECT * FROM users').all()
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
      expect(dbChildren).toHaveLength(3)
    })

    const spans = await collector.store.recentSpans(10)
    const detail = await collector.store.spanById(spans[0]!.id)
    const dbChildren = detail!.childSpans.filter((child) => child.kind === 'db')
    const operations = dbChildren.map((child) => child.kind === 'db' && child.operation)
    expect(operations).toContain('INSERT')
    expect(operations).toContain('SELECT')
    const insertChild = dbChildren.find((child) => child.kind === 'db' && child.operation === 'INSERT')
    expect(insertChild?.kind === 'db' && insertChild.system).toBe('sqlite')
    expect(insertChild?.kind === 'db' && insertChild.rowCount).toBe(1)

    db.close()
  })

  it('does nothing when no request span is active', async () => {
    instrumentDatabases()
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t (id INTEGER)')
    db.prepare('INSERT INTO t (id) VALUES (?)').run(1)
    expect(db.prepare('SELECT * FROM t').all()).toHaveLength(1)
    db.close()
  })
})
