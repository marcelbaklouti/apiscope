import { describe, expect, it } from 'vitest'
import { slowDependencyRule } from '../../src/rules/slow-dependency'
import { context, dbChild, fetchChild, span } from '../fixtures'

describe('slow-dependency rule', () => {
  it('fires when one db query dominates the route time', () => {
    const parents = Array.from({ length: 12 }, () =>
      span({ routePattern: '/api/report', framework: 'express', timing: { start: 0, ttfb: 5, duration: 200 } })
    )
    const childSpans = parents.map((parent) =>
      dbChild(parent.id, { statement: 'SELECT * FROM big_table WHERE x = 1', timing: { start: 0, ttfb: null, duration: 180 } })
    )
    const findings = slowDependencyRule.detect(context({ spans: parents, childSpans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('slow-dependency')
    expect(findings[0]!.impact.humanized).toContain('%')
    expect(findings[0]!.fix.explanation.toLowerCase()).toMatch(/index|cache|timeout/)
  })

  it('fires for a dominating outbound fetch', () => {
    const parents = Array.from({ length: 12 }, () =>
      span({ routePattern: '/api/proxy', timing: { start: 0, ttfb: 5, duration: 200 } })
    )
    const childSpans = parents.map((parent) =>
      fetchChild(parent.id, { url: 'http://payments.internal/charge', timing: { start: 0, ttfb: 5, duration: 170 } })
    )
    const findings = slowDependencyRule.detect(context({ spans: parents, childSpans }))
    expect(findings).toHaveLength(1)
  })

  it('stays silent when no single dependency dominates', () => {
    const parents = Array.from({ length: 12 }, () => span({ routePattern: '/api/report', timing: { start: 0, ttfb: 5, duration: 200 } }))
    const childSpans = parents.map((parent) => dbChild(parent.id, { timing: { start: 0, ttfb: null, duration: 10 } }))
    expect(slowDependencyRule.detect(context({ spans: parents, childSpans }))).toHaveLength(0)
  })
})
