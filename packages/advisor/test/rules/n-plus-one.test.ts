import { describe, expect, it } from 'vitest'
import { detectNPlusOneGroups, nPlusOneRule } from '../../src/rules/n-plus-one'
import { context, dbChild, span } from '../fixtures'

describe('detectNPlusOneGroups', () => {
  it('groups repeated parameterized queries into one template', () => {
    const parent = span()
    const children = Array.from({ length: 6 }, (_unused, index) =>
      dbChild(parent.id, { statement: `SELECT * FROM comments WHERE post_id = ${index}`, timing: { start: 0, ttfb: null, duration: 2 } })
    )
    const groups = detectNPlusOneGroups(children)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.count).toBe(6)
    expect(groups[0]!.template).toContain('post_id = ?')
    expect(groups[0]!.totalDurationMs).toBe(12)
  })
})

describe('n-plus-one rule', () => {
  it('fires for a route whose requests each run the same query many times', () => {
    const parents = Array.from({ length: 4 }, () => span({ routePattern: '/api/posts', framework: 'express' }))
    const childSpans = parents.flatMap((parent) =>
      Array.from({ length: 6 }, (_unused, index) => dbChild(parent.id, { statement: `SELECT * FROM comments WHERE post_id = ${index}` }))
    )
    const findings = nPlusOneRule.detect(context({ spans: parents, childSpans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('n-plus-one')
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.scope.routePattern).toBe('/api/posts')
    expect(findings[0]!.fix.explanation.toLowerCase()).toContain('n+1')
  })

  it('stays silent when a request runs only distinct queries', () => {
    const parent = span({ routePattern: '/api/posts' })
    const childSpans = [
      dbChild(parent.id, { statement: 'SELECT * FROM posts' }),
      dbChild(parent.id, { statement: 'SELECT * FROM users' })
    ]
    expect(nPlusOneRule.detect(context({ spans: [parent], childSpans }))).toHaveLength(0)
  })

  it('stays silent below the minimum affected-request count', () => {
    const parent = span({ routePattern: '/api/posts' })
    const childSpans = Array.from({ length: 6 }, (_unused, index) =>
      dbChild(parent.id, { statement: `SELECT * FROM comments WHERE post_id = ${index}` })
    )
    const findings = nPlusOneRule.detect({
      ...context({ spans: [parent], childSpans }),
      config: { ...context({}).config, rules: { ...context({}).config.rules, 'n-plus-one': { minimumSampleSize: 3, enabled: true } } }
    })
    expect(findings).toHaveLength(0)
  })
})
