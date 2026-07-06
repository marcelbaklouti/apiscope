import { describe, expect, it } from 'vitest'
import { errorHotspotRule } from '../../src/rules/error-hotspot'
import { context, routeStat, span } from '../fixtures'

describe('error-hotspot rule', () => {
  it('warns on an elevated 5xx rate', () => {
    const stats = [routeStat({ routePattern: '/api/checkout', count: 100, errorCount: 8 })]
    const spans = Array.from({ length: 8 }, () => span({ routePattern: '/api/checkout', statusCode: 500 }))
    const findings = errorHotspotRule.detect(context({ spans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('error-hotspot')
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.impact.metric).toBe('errorRate=8%')
  })

  it('escalates to critical past the high bound', () => {
    const stats = [routeStat({ routePattern: '/api/checkout', count: 100, errorCount: 20 })]
    const spans = Array.from({ length: 20 }, () => span({ routePattern: '/api/checkout', statusCode: 503 }))
    expect(errorHotspotRule.detect(context({ spans, routeStats: stats }))[0]!.severity).toBe('critical')
  })

  it('fires on a heavy clustered-4xx rate even with no 5xx', () => {
    const stats = [routeStat({ routePattern: '/api/login', count: 100, errorCount: 0 })]
    const spans = Array.from({ length: 40 }, () => span({ routePattern: '/api/login', statusCode: 401 }))
    const findings = errorHotspotRule.detect(context({ spans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.impact.humanized).toContain('4xx')
  })

  it('stays silent at a healthy error rate', () => {
    const stats = [routeStat({ routePattern: '/api/ok', count: 100, errorCount: 1 })]
    const spans = Array.from({ length: 1 }, () => span({ routePattern: '/api/ok', statusCode: 500 }))
    expect(errorHotspotRule.detect(context({ spans, routeStats: stats }))).toHaveLength(0)
  })

  it('stays silent below the minimum sample size', () => {
    const stats = [routeStat({ routePattern: '/api/checkout', count: 5, errorCount: 3 })]
    expect(errorHotspotRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })
})
