import type { RequestSpan } from '@apiscope/core'
import type { SpanStore } from '../store-interface'

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

type Describe = (name: string, fn: () => void) => void
type It = (name: string, fn: () => Promise<void> | void) => void
type Expect = (actual: unknown) => { toEqual(expected: unknown): void; toBeNull(): void; toHaveLength(n: number): void; not: { toBeNull(): void } }

export function runStoreConformance(
  createStore: () => Promise<SpanStore>,
  describe: Describe,
  it: It,
  expect: Expect
): void {
  describe('SpanStore conformance', () => {
    it('persists spans with child spans and reads by id', async () => {
      const store = await createStore()
      await store.init()
      const parent = span({ id: 'p1', error: { message: 'boom' } })
      await store.insertBatch('demo', {
        spans: [parent],
        childSpans: [
          { id: 'c1', parentSpanId: 'p1', traceId: 'trace', kind: 'fetch', url: 'http://x', method: 'GET', statusCode: 200, timing: { start: 1001, ttfb: 1, duration: 3 } }
        ]
      })
      const loaded = await store.spanById('p1')
      expect(loaded?.span).toEqual(parent)
      expect(loaded?.childSpans).toHaveLength(1)
      expect(await store.spanById('missing')).toBeNull()
      await store.close()
    })

    it('persists spans carrying a parent span id and load-run id', async () => {
      const store = await createStore()
      await store.init()
      const withLinkage = span({
        id: 'p2',
        parentSpanId: 'bbbbbbbbbbbbbbbb',
        loadRunId: 'ccccccccccccccccc'
      })
      await store.insertBatch('demo', { spans: [withLinkage], childSpans: [] })
      const loaded = await store.spanById('p2')
      expect(loaded?.span).toEqual(withLinkage)
      await store.close()
    })

    it('returns recent spans newest first', async () => {
      const store = await createStore()
      await store.init()
      await store.insertBatch('demo', { spans: [span({ id: 'a', timing: { start: 1, ttfb: null, duration: 1 } })], childSpans: [] })
      await store.insertBatch('demo', { spans: [span({ id: 'b', timing: { start: 2, ttfb: null, duration: 1 } })], childSpans: [] })
      const recent = await store.recentSpans(2)
      expect(recent[0]?.id).toEqual('b')
      await store.close()
    })

    it('replaces routes per app', async () => {
      const store = await createStore()
      await store.init()
      await store.replaceRoutes('demo', [{ method: 'GET', pattern: '/old' }])
      await store.replaceRoutes('demo', [{ method: 'GET', pattern: '/new', sourceFile: 'src/new.ts' }])
      await store.replaceRoutes('other', [{ method: 'POST', pattern: '/other' }])
      const routes = await store.listRoutes()
      expect(routes.some((r) => r.pattern === '/new' && r.appName === 'demo')).toEqual(true)
      expect(routes.some((r) => r.pattern === '/old')).toEqual(false)
      expect(routes.some((r) => r.pattern === '/other' && r.appName === 'other')).toEqual(true)
      await store.close()
    })

    it('computes route stats with percentiles and error counts', async () => {
      const store = await createStore()
      await store.init()
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      await store.insertBatch('demo', {
        spans: durations.map((duration, index) =>
          span({ id: `s${index}`, timing: { start: index, ttfb: null, duration }, statusCode: index === 9 ? 500 : 200 })
        ),
        childSpans: []
      })
      const stats = await store.routeStats()
      const entry = stats.find((s) => s.routePattern === '/users/:id' && s.method === 'GET')
      expect(entry?.count).toEqual(10)
      expect(entry?.errorCount).toEqual(1)
      expect((entry?.p50 ?? 0) <= (entry?.p95 ?? 0) && (entry?.p95 ?? 0) <= (entry?.p99 ?? 0)).toEqual(true)
      await store.close()
    })

    it('persists and lists load runs newest first', async () => {
      const store = await createStore()
      await store.init()
      await store.insertLoadRun({ id: 'r1', name: 'smoke', startedAt: 1000, scenarioJson: '{}', resultJson: '{"p95":12}' })
      await store.insertLoadRun({ id: 'r2', name: 'soak', startedAt: 2000, scenarioJson: '{}', resultJson: '{}' })
      const list = await store.listLoadRuns()
      expect(list[0]?.id).toEqual('r2')
      const detail = await store.loadRunById('r1')
      expect(detail?.resultJson).toEqual('{"p95":12}')
      await store.close()
    })
  })
}
