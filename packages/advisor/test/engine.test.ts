import { describe, expect, it } from 'vitest'
import type { Rule } from '../src/engine'
import { rankFindings, runRules } from '../src/engine'
import { context, span } from './fixtures'
import type { Finding } from '../src/types'

function finding(overrides: Partial<Finding>): Finding {
  return {
    ruleId: 'r',
    category: 'performance',
    severity: 'warning',
    title: 't',
    whatAndWhy: 'w',
    impact: { metric: 'm', humanized: 'h' },
    scope: { level: 'global' },
    evidence: { spanIds: [], deepLink: '#/' },
    fix: { framework: 'express', explanation: 'e' },
    sampleSize: 10,
    ...overrides
  }
}

describe('runRules', () => {
  it('isolates a throwing rule but still records it as run', () => {
    const good: Rule = { id: 'good', category: 'performance', detect: () => [finding({ ruleId: 'good' })] }
    const bad: Rule = {
      id: 'bad',
      category: 'performance',
      detect: () => {
        throw new Error('boom')
      }
    }
    const result = runRules([good, bad], context({ spans: [span(), span()] }))
    expect(result.findings.map((entry) => entry.ruleId)).toEqual(['good'])
    expect(result.rulesRun).toEqual(['good', 'bad'])
  })

  it('skips a rule disabled in config', () => {
    const config = { ...context({}).config }
    config.rules = { ...config.rules, good: { minimumSampleSize: 1, enabled: false } }
    const good: Rule = { id: 'good', category: 'performance', detect: () => [finding({ ruleId: 'good' })] }
    const result = runRules([good], { ...context({ spans: [span()] }), config })
    expect(result.findings).toHaveLength(0)
    expect(result.rulesRun).toEqual([])
  })

  it('flags insufficientData below the overall minimum sample size', () => {
    const noop: Rule = { id: 'noop', category: 'performance', detect: () => [] }
    const result = runRules([noop], context({ spans: [span()] }))
    expect(result.insufficientData).toBe(true)
  })
})

describe('rankFindings', () => {
  it('orders critical with a paste-ready fix ahead of an advisory guidance-only finding', () => {
    const critical = finding({
      ruleId: 'c',
      severity: 'critical',
      sampleSize: 100,
      fix: { framework: 'express', explanation: 'e', codeSnippet: 'x' }
    })
    const advisory = finding({ ruleId: 'a', severity: 'advisory', sampleSize: 5 })
    const ranked = rankFindings([advisory, critical], 100)
    expect(ranked.map((entry) => entry.ruleId)).toEqual(['c', 'a'])
  })
})
