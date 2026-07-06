import { describe, expect, it } from 'vitest'
import type { Finding } from '../src/index'

describe('Finding model', () => {
  it('constructs a well-formed finding', () => {
    const finding: Finding = {
      ruleId: 'uncompressed-responses',
      category: 'payload',
      severity: 'warning',
      title: '3 routes send uncompressed responses',
      whatAndWhy: 'Text responses over ~1.4 KB are sent without gzip or brotli, so clients download more bytes than needed.',
      impact: { metric: 'avgBytes=143210', humanized: '~140 KB to ~28 KB, affects 45% of traffic' },
      scope: { level: 'global' },
      evidence: { spanIds: ['a', 'b'], deepLink: '#/routes' },
      fix: { framework: 'express', explanation: 'Enable the compression middleware.', codeSnippet: "app.use(compression())" },
      sampleSize: 20
    }
    expect(finding.category).toBe('payload')
    expect(finding.fix.framework).toBe('express')
    expect(finding.evidence.spanIds).toHaveLength(2)
  })
})
