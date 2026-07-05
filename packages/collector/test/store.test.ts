import { describe, expect, it } from 'vitest'
import type { RequestSpan } from '@apiscope/core'
import { SqliteSpanStore } from '../src/store'

function span(overrides: Partial<RequestSpan>): RequestSpan {
  return {
    id: crypto.randomUUID(),
    traceId: 'trace',
    method: 'GET',
    routePattern: '/users/:id',
    actualPath: '/users/1',
    statusCode: 200,
    timing: { start: 1000, ttfb: 5, duration: 10 },
    framework: 'express',
    runtime: 'node',
    ...overrides
  }
}

describe('SqliteSpanStore', () => {
  it('persists spans with child spans and reads them back', async () => {
    const store = new SqliteSpanStore(':memory:')
    const parent = span({ id: 'p1', error: { message: 'boom' }, request: { headers: { a: 'b' }, truncated: false, redactedHeaders: [] } })
    await store.insertBatch('demo', {
      spans: [parent],
      childSpans: [{ id: 'c1', parentSpanId: 'p1', traceId: 'trace', kind: 'fetch', url: 'http://x', method: 'GET', statusCode: 200, timing: { start: 1001, ttfb: 1, duration: 3 } }]
    })
    const loaded = await store.spanById('p1')
    expect(loaded?.span).toEqual(parent)
    expect(loaded?.childSpans).toHaveLength(1)
    expect(loaded?.childSpans[0]?.id).toBe('c1')
    expect(await store.spanById('missing')).toBeNull()
    await store.close()
  })

  it('returns recent spans newest first', async () => {
    const store = new SqliteSpanStore(':memory:')
    await store.insertBatch('demo', { spans: [span({ id: 'a' }), span({ id: 'b' })], childSpans: [] })
    await store.insertBatch('demo', { spans: [span({ id: 'c' })], childSpans: [] })
    expect((await store.recentSpans(2)).map((entry) => entry.id)).toEqual(['c', 'b'])
    await store.close()
  })

  it('enforces ring buffer retention including child spans', async () => {
    const store = new SqliteSpanStore(':memory:', { retentionRows: 2 })
    await store.insertBatch('demo', {
      spans: [span({ id: 'a' })],
      childSpans: [{ id: 'ca', parentSpanId: 'a', traceId: 't', kind: 'fetch', url: 'http://x', method: 'GET', statusCode: 200, timing: { start: 1, ttfb: null, duration: 1 } }]
    })
    await store.insertBatch('demo', { spans: [span({ id: 'b' }), span({ id: 'c' })], childSpans: [] })
    expect((await store.recentSpans(10)).map((entry) => entry.id)).toEqual(['c', 'b'])
    expect(await store.spanById('a')).toBeNull()
    await store.close()
  })

  it('replaces the route registry per app', async () => {
    const store = new SqliteSpanStore(':memory:')
    await store.replaceRoutes('demo', [{ method: 'GET', pattern: '/old' }])
    await store.replaceRoutes('demo', [{ method: 'GET', pattern: '/new', sourceFile: 'src/new.ts' }])
    await store.replaceRoutes('other', [{ method: 'POST', pattern: '/other' }])
    expect(await store.listRoutes()).toEqual([
      { appName: 'demo', method: 'GET', pattern: '/new', sourceFile: 'src/new.ts' },
      { appName: 'other', method: 'POST', pattern: '/other' }
    ])
    await store.close()
  })

  it('computes route stats with percentiles and error counts', async () => {
    const store = new SqliteSpanStore(':memory:')
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    await store.insertBatch('demo', {
      spans: durations.map((duration, index) =>
        span({ id: `s${index}`, timing: { start: 0, ttfb: null, duration }, statusCode: index === 9 ? 500 : 200 })
      ),
      childSpans: []
    })
    const stats = await store.routeStats()
    expect(stats).toHaveLength(1)
    expect(stats[0]).toEqual({
      routePattern: '/users/:id',
      method: 'GET',
      count: 10,
      errorCount: 1,
      p50: 50,
      p95: 100,
      p99: 100
    })
    await store.close()
  })
})
