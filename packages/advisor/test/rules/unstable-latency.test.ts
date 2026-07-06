import { describe, expect, it } from 'vitest'
import { unstableLatencyRule } from '../../src/rules/unstable-latency'
import { context, routeStat, span } from '../fixtures'

describe('unstable-latency rule', () => {
  it('fires when p99/p50 exceeds the ratio', () => {
    const stats = [routeStat({ routePattern: '/api/spiky', p50: 20, p95: 120, p99: 400, count: 60 })]
    const spans = Array.from({ length: 60 }, () => span({ routePattern: '/api/spiky' }))
    const findings = unstableLatencyRule.detect(context({ spans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('unstable-latency')
    expect(findings[0]!.impact.metric).toBe('p99/p50=20.0')
  })

  it('stays silent for a stable route', () => {
    const stats = [routeStat({ routePattern: '/api/stable', p50: 20, p95: 30, p99: 45, count: 60 })]
    expect(unstableLatencyRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })

  it('stays silent below the minimum sample size', () => {
    const stats = [routeStat({ routePattern: '/api/spiky', p50: 20, p99: 400, count: 5 })]
    expect(unstableLatencyRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })
})
