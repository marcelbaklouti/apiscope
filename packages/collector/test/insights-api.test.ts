import { afterEach, describe, expect, it } from 'vitest'
import type { CapturedPayload, DbChildSpan, RequestSpan } from '@apiscope/core'
import { createCollector, type Collector } from '../src/index'
import type { SpanStore } from '../src/store-interface'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

function jsonBig(): CapturedPayload {
  return { headers: { 'content-type': 'application/json', 'content-length': '30000' }, truncated: false, redactedHeaders: [] }
}

async function seed(collector: Collector) {
  await collector.store.replaceRoutes('demo', [{ method: 'GET', pattern: '/api/report' }])
  const spans: RequestSpan[] = Array.from({ length: 40 }, (_unused, index) => ({
    id: `s-${index}`,
    traceId: `t-${index}`,
    method: 'GET',
    routePattern: '/api/report',
    actualPath: '/api/report',
    statusCode: 200,
    timing: { start: 0, ttfb: 5, duration: 60 },
    framework: 'express',
    runtime: 'node',
    response: jsonBig()
  }))
  await collector.store.insertBatch('demo', { spans, childSpans: [] })
}

describe('GET /api/insights', () => {
  it('returns findings over a seeded store', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    await seed(collector)
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as {
      findings: Array<{ ruleId: string }>
      rulesRun: string[]
      insufficientData: boolean
      advisorEnabled: boolean
      windowSampleSize: number
    }
    expect(body.advisorEnabled).toBe(true)
    expect(body.insufficientData).toBe(false)
    expect(body.windowSampleSize).toBe(40)
    expect(body.findings.some((finding) => finding.ruleId === 'uncompressed-responses')).toBe(true)
  })

  it('reports insufficientData below the overall minimum sample size', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    await collector.store.insertBatch('demo', {
      spans: [
        { id: 's1', traceId: 't1', method: 'GET', routePattern: '/x', actualPath: '/x', statusCode: 200, timing: { start: 0, ttfb: 1, duration: 5 }, framework: 'express', runtime: 'node' }
      ],
      childSpans: []
    })
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as { insufficientData: boolean }
    expect(body.insufficientData).toBe(true)
  })

  it('can be disabled via the advisor config option', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, advisor: { enabled: false } })
    const { port } = await collector.listen()
    await seed(collector)
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as { advisorEnabled: boolean; findings: unknown[] }
    expect(body.advisorEnabled).toBe(false)
    expect(body.findings).toHaveLength(0)
  })

  it('honors a lowered slow-route threshold from advisor config', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, advisor: { thresholds: { slowRouteP95Ms: 10 }, rules: { 'slow-route': { minimumSampleSize: 5 } } } })
    const { port } = await collector.listen()
    await seed(collector)
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as { findings: Array<{ ruleId: string }> }
    expect(body.findings.some((finding) => finding.ruleId === 'slow-route')).toBe(true)
  })

  it('degrades to an empty analysis when the store throws', async () => {
    const throwingStore = {
      recoveredFromCorruption: false,
      async insertBatch() {},
      async replaceRoutes() {},
      async listRoutes() { return [] },
      async recentSpans() { return [] },
      async spansByLoadRun() { return [] },
      async spanById() { return null },
      async routeStats(): Promise<never> { throw new Error('store down') },
      async insertLoadRun() {},
      async listLoadRuns() { return [] },
      async loadRunById() { return null },
      async init() {},
      async close() {}
    } satisfies SpanStore
    collector = createCollector({ dbPath: ':memory:', port: 0, store: throwingStore })
    const { port } = await collector.listen()
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as { error?: string; findings: unknown[]; advisorEnabled: boolean }
    expect(body.error).toBe('analysis-failed')
    expect(body.findings).toHaveLength(0)
    expect(body.advisorEnabled).toBe(true)
  })
})
