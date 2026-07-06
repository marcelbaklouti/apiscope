import { describe, expect, it } from 'vitest'
import { oversizedPayloadRule } from '../../src/rules/oversized-payload'
import { context, span } from '../fixtures'

function jsonBytes(bytes: number) {
  return { headers: { 'content-type': 'application/json', 'content-length': String(bytes) }, truncated: false, redactedHeaders: [] }
}

describe('oversized-payload rule', () => {
  it('fires for a list route consistently returning >100 KB JSON', () => {
    const spans = Array.from({ length: 6 }, () => span({ routePattern: '/api/products', response: jsonBytes(250000) }))
    const findings = oversizedPayloadRule.detect(context({ spans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('oversized-payload')
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.scope.routePattern).toBe('/api/products')
    expect(findings[0]!.impact.humanized).toContain('KB')
    expect(findings[0]!.fix.explanation.toLowerCase()).toContain('paginate')
  })

  it('stays silent for small payloads', () => {
    const spans = Array.from({ length: 6 }, () => span({ response: jsonBytes(2000) }))
    expect(oversizedPayloadRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('stays silent when only an occasional response is large', () => {
    const spans = [
      span({ routePattern: '/api/products', response: jsonBytes(250000) }),
      ...Array.from({ length: 6 }, () => span({ routePattern: '/api/products', response: jsonBytes(2000) }))
    ]
    expect(oversizedPayloadRule.detect(context({ spans }))).toHaveLength(0)
  })
})
