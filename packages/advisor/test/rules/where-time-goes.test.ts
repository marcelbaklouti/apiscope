import { describe, expect, it } from 'vitest'
import { whereTimeGoesRule } from '../../src/rules/where-time-goes'
import { context, dbChild, routeStat, span } from '../fixtures'

describe('where-time-goes rule', () => {
  it('attributes most of a slow route to the database when db child spans dominate', () => {
    const spans = Array.from({ length: 12 }, () =>
      span({ routePattern: '/api/report', timing: { start: 0, ttfb: 5, duration: 100 } })
    )
    const childSpans = spans.map((parent) =>
      dbChild(parent.id, { timing: { start: 0, ttfb: null, duration: 90 } })
    )
    const stats = [routeStat({ routePattern: '/api/report', p95: 700, count: 12 })]
    const findings = whereTimeGoesRule.detect(context({ spans, childSpans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('where-time-goes')
    expect(findings[0]!.impact.metric).toContain('db=')
    expect(findings[0]!.impact.humanized.toLowerCase()).toContain('database')
    expect(findings[0]!.severity).toBe('warning')
  })

  it('stays silent for a slow route with no child spans (nothing to attribute)', () => {
    const spans = Array.from({ length: 12 }, () => span({ routePattern: '/api/cpu' }))
    const stats = [routeStat({ routePattern: '/api/cpu', p95: 700, count: 12 })]
    expect(whereTimeGoesRule.detect(context({ spans, childSpans: [], routeStats: stats }))).toHaveLength(0)
  })

  it('stays silent when the route is within budget', () => {
    const spans = Array.from({ length: 12 }, () => span({ routePattern: '/api/fast' }))
    const childSpans = spans.map((parent) => dbChild(parent.id))
    const stats = [routeStat({ routePattern: '/api/fast', p95: 50, count: 12 })]
    expect(whereTimeGoesRule.detect(context({ spans, childSpans, routeStats: stats }))).toHaveLength(0)
  })
})
