import { describe, expect, it } from 'vitest'
import { missingCacheHeadersRule } from '../../src/rules/missing-cache'
import { context, span } from '../fixtures'

function bareResponse() {
  return { headers: { 'content-type': 'application/json' }, truncated: false, redactedHeaders: [] }
}

describe('missing-cache-headers rule', () => {
  it('fires for a repeated identical GET returning 200 with no cache headers', () => {
    const spans = Array.from({ length: 6 }, () =>
      span({ method: 'GET', statusCode: 200, routePattern: '/api/config', actualPath: '/api/config', response: bareResponse() })
    )
    const findings = missingCacheHeadersRule.detect(context({ spans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('missing-cache-headers')
    expect(findings[0]!.severity).toBe('advisory')
    expect(findings[0]!.scope.routePattern).toBe('/api/config')
  })

  it('stays silent when cache-control is present', () => {
    const spans = Array.from({ length: 6 }, () =>
      span({ method: 'GET', statusCode: 200, actualPath: '/api/config', response: { headers: { 'cache-control': 'max-age=60' }, truncated: false, redactedHeaders: [] } })
    )
    expect(missingCacheHeadersRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('stays silent when an etag is present', () => {
    const spans = Array.from({ length: 6 }, () =>
      span({ method: 'GET', statusCode: 200, actualPath: '/api/config', response: { headers: { etag: 'W/"x"' }, truncated: false, redactedHeaders: [] } })
    )
    expect(missingCacheHeadersRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('ignores non-GET and non-200', () => {
    const spans = [
      ...Array.from({ length: 6 }, () => span({ method: 'POST', statusCode: 200, response: bareResponse() })),
      ...Array.from({ length: 6 }, () => span({ method: 'GET', statusCode: 500, response: bareResponse() }))
    ]
    expect(missingCacheHeadersRule.detect(context({ spans }))).toHaveLength(0)
  })
})
