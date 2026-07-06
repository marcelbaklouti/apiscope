import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import { context, dbChild, routeStat, span } from './fixtures'
import { resolveAdvisorConfig } from '../src/config'

describe('analyze', () => {
  it('runs every rule and returns a ranked mixed set of findings', () => {
    const jsonBig = { headers: { 'content-type': 'application/json', 'content-length': '30000' }, truncated: false, redactedHeaders: [] }
    const spans = [
      ...Array.from({ length: 40 }, () => span({ routePattern: '/api/report', framework: 'express', response: jsonBig, timing: { start: 0, ttfb: 5, duration: 200 } })),
      ...Array.from({ length: 8 }, () => span({ routePattern: '/api/checkout', statusCode: 500 }))
    ]
    const childSpans = spans
      .filter((entry) => entry.routePattern === '/api/report')
      .flatMap((parent) => Array.from({ length: 6 }, (_unused, index) => dbChild(parent.id, { statement: `SELECT * FROM x WHERE id = ${index}` })))
    const routeStats = [
      routeStat({ routePattern: '/api/report', p50: 40, p95: 700, p99: 900, count: 40 }),
      routeStat({ routePattern: '/api/checkout', count: 100, errorCount: 8, p95: 50 })
    ]
    const result = analyze(context({ spans, childSpans, routeStats }))
    const ruleIds = new Set(result.findings.map((finding) => finding.ruleId))
    expect(ruleIds.has('uncompressed-responses')).toBe(true)
    expect(ruleIds.has('slow-route')).toBe(true)
    expect(ruleIds.has('n-plus-one')).toBe(true)
    expect(ruleIds.has('error-hotspot')).toBe(true)
    expect(result.rulesRun.length).toBe(10)
    expect(result.insufficientData).toBe(false)
  })

  it('returns nothing when disabled', () => {
    const result = analyze(context({ spans: [span(), span()], config: resolveAdvisorConfig({ enabled: false }) }))
    expect(result.findings).toHaveLength(0)
    expect(result.rulesRun).toHaveLength(0)
    expect(result.insufficientData).toBe(true)
  })
})
