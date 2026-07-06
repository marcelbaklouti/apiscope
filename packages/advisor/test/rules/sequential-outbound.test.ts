import { describe, expect, it } from 'vitest'
import { nonOverlappingFetches, sequentialOutboundRule } from '../../src/rules/sequential-outbound'
import { context, fetchChild, span } from '../fixtures'

describe('nonOverlappingFetches', () => {
  it('detects two back-to-back fetches as sequential', () => {
    const parent = span()
    const children = [
      fetchChild(parent.id, { timing: { start: 0, ttfb: 10, duration: 40 } }),
      fetchChild(parent.id, { timing: { start: 40, ttfb: 10, duration: 40 } })
    ]
    expect(nonOverlappingFetches(children)).toHaveLength(2)
  })

  it('returns empty when fetches overlap (already parallel)', () => {
    const parent = span()
    const children = [
      fetchChild(parent.id, { timing: { start: 0, ttfb: 10, duration: 40 } }),
      fetchChild(parent.id, { timing: { start: 5, ttfb: 10, duration: 40 } })
    ]
    expect(nonOverlappingFetches(children)).toHaveLength(0)
  })
})

describe('sequential-outbound rule', () => {
  it('fires for a route that serializes independent outbound calls', () => {
    const parents = Array.from({ length: 4 }, () => span({ routePattern: '/api/aggregate', framework: 'express' }))
    const childSpans = parents.flatMap((parent) => [
      fetchChild(parent.id, { timing: { start: 0, ttfb: 10, duration: 40 } }),
      fetchChild(parent.id, { timing: { start: 40, ttfb: 10, duration: 40 } })
    ])
    const findings = sequentialOutboundRule.detect(context({ spans: parents, childSpans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('sequential-outbound')
    expect(findings[0]!.fix.codeSnippet).toContain('Promise.all')
  })

  it('stays silent when the calls already overlap', () => {
    const parents = Array.from({ length: 4 }, () => span({ routePattern: '/api/aggregate' }))
    const childSpans = parents.flatMap((parent) => [
      fetchChild(parent.id, { timing: { start: 0, ttfb: 10, duration: 40 } }),
      fetchChild(parent.id, { timing: { start: 2, ttfb: 10, duration: 40 } })
    ])
    expect(sequentialOutboundRule.detect(context({ spans: parents, childSpans }))).toHaveLength(0)
  })
})
