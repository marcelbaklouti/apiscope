import { describe, expect, it } from 'vitest'
import { uncompressedResponsesRule } from '../../src/rules/uncompressed'
import { context, span } from '../fixtures'

function jsonResponse(bytes: number, encoding?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(bytes) }
  if (encoding !== undefined) headers['content-encoding'] = encoding
  return { headers, truncated: false, redactedHeaders: [] }
}

describe('uncompressed-responses rule', () => {
  it('fires for a route serving large uncompressed JSON', () => {
    const spans = Array.from({ length: 8 }, () =>
      span({ routePattern: '/api/list', framework: 'express', response: jsonResponse(20000) })
    )
    const findings = uncompressedResponsesRule.detect(context({ spans }))
    expect(findings).toHaveLength(1)
    const finding = findings[0]!
    expect(finding.ruleId).toBe('uncompressed-responses')
    expect(finding.severity).toBe('warning')
    expect(finding.sampleSize).toBe(8)
    expect(finding.fix.framework).toBe('express')
    expect(finding.fix.codeSnippet).toContain('compression')
    expect(finding.impact.humanized).toContain('%')
  })

  it('stays silent when responses are already gzip-encoded', () => {
    const spans = Array.from({ length: 8 }, () =>
      span({ routePattern: '/api/list', response: jsonResponse(20000, 'gzip') })
    )
    expect(uncompressedResponsesRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('stays silent below the small-body threshold', () => {
    const spans = Array.from({ length: 8 }, () => span({ response: jsonResponse(200) }))
    expect(uncompressedResponsesRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('stays silent below the minimum sample size', () => {
    const spans = Array.from({ length: 2 }, () => span({ response: jsonResponse(20000) }))
    expect(uncompressedResponsesRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('does not flag non-text content types', () => {
    const spans = Array.from({ length: 8 }, () =>
      span({ response: { headers: { 'content-type': 'image/png', 'content-length': '90000' }, truncated: false, redactedHeaders: [] } })
    )
    expect(uncompressedResponsesRule.detect(context({ spans }))).toHaveLength(0)
  })
})
