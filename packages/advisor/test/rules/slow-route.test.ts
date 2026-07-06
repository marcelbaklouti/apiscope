import { describe, expect, it } from 'vitest'
import { slowRouteRule } from '../../src/rules/slow-route'
import { context, routeStat, span } from '../fixtures'

describe('slow-route rule', () => {
  it('warns when p95 exceeds the budget with enough samples', () => {
    const stats = [routeStat({ routePattern: '/api/report', p95: 574, count: 40 })]
    const spans = Array.from({ length: 40 }, (_unused, index) =>
      span({ routePattern: '/api/report', framework: 'fastify', timing: { start: 0, ttfb: 10, duration: 500 + index } })
    )
    const findings = slowRouteRule.detect(context({ spans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.impact.metric).toBe('p95=574ms')
    expect(findings[0]!.fix.framework).toBe('fastify')
    expect(findings[0]!.evidence.spanIds.length).toBeGreaterThan(0)
  })

  it('escalates to critical past the higher bound', () => {
    const stats = [routeStat({ routePattern: '/api/slow', p95: 1500, count: 40 })]
    const spans = Array.from({ length: 40 }, () => span({ routePattern: '/api/slow' }))
    const findings = slowRouteRule.detect(context({ spans, routeStats: stats }))
    expect(findings[0]!.severity).toBe('critical')
  })

  it('stays silent below the budget', () => {
    const stats = [routeStat({ routePattern: '/api/fast', p95: 120, count: 40 })]
    expect(slowRouteRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })

  it('stays silent below the minimum sample size', () => {
    const stats = [routeStat({ routePattern: '/api/report', p95: 900, count: 3 })]
    expect(slowRouteRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })
})
