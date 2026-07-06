import type { ChildSpan, RequestSpan } from '@apiscope/core'
import type { AdvisorContext, Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { formatPercent } from '../util/statement'

interface Attribution {
  codeMs: number
  dbMs: number
  fetchMs: number
  spanIds: string[]
}

function attributeRoute(spans: RequestSpan[], childrenByParent: Map<string, ChildSpan[]>): Attribution | null {
  let codeMs = 0
  let dbMs = 0
  let fetchMs = 0
  const spanIds: string[] = []
  let withChildren = 0
  for (const span of spans) {
    const children = childrenByParent.get(span.id) ?? []
    if (children.length === 0) continue
    withChildren += 1
    spanIds.push(span.id)
    let spanDb = 0
    let spanFetch = 0
    for (const child of children) {
      if (child.kind === 'db') spanDb += child.timing.duration
      else spanFetch += child.timing.duration
    }
    dbMs += spanDb
    fetchMs += spanFetch
    codeMs += Math.max(0, span.timing.duration - spanDb - spanFetch)
  }
  if (withChildren === 0) return null
  return { codeMs: codeMs / withChildren, dbMs: dbMs / withChildren, fetchMs: fetchMs / withChildren, spanIds }
}

function childrenByParentMap(childSpans: ChildSpan[]): Map<string, ChildSpan[]> {
  const map = new Map<string, ChildSpan[]>()
  for (const child of childSpans) map.set(child.parentSpanId, [...(map.get(child.parentSpanId) ?? []), child])
  return map
}

export const whereTimeGoesRule: Rule = {
  id: 'where-time-goes',
  category: 'performance',
  detect(context: AdvisorContext): Finding[] {
    const minSample = context.config.rules['where-time-goes']?.minimumSampleSize ?? 10
    const warnMs = context.config.thresholds.slowRouteP95Ms
    const childrenByParent = childrenByParentMap(context.childSpans)
    const fallbackFramework = context.apps[0]?.framework ?? 'unknown'
    const findings: Finding[] = []
    for (const stats of context.routeStats) {
      if (stats.count < minSample || stats.p95 < warnMs) continue
      const routeSpans = context.spans.filter(
        (span) => span.routePattern === stats.routePattern && span.method === stats.method
      )
      const attribution = attributeRoute(routeSpans, childrenByParent)
      if (attribution === null) continue
      const total = attribution.codeMs + attribution.dbMs + attribution.fetchMs
      if (total <= 0) continue
      const buckets: Array<{ key: 'db' | 'code' | 'outbound'; label: string; ms: number }> = [
        { key: 'db', label: 'one or more database queries', ms: attribution.dbMs },
        { key: 'code', label: 'your own code (CPU or blocking work)', ms: attribution.codeMs },
        { key: 'outbound', label: 'outbound calls to other services', ms: attribution.fetchMs }
      ]
      const dominant = [...buckets].sort((left, right) => right.ms - left.ms)[0]!
      const dominantShare = dominant.ms / total
      const routePattern = stats.routePattern ?? '(unmatched)'
      findings.push({
        ruleId: 'where-time-goes',
        category: 'performance',
        severity: dominantShare >= 0.5 ? 'warning' : 'advisory',
        title: `Where ${stats.method} ${routePattern}'s time goes`,
        whatAndWhy: 'This slow route breaks down across your code, the database, and outbound calls so you can fix the part that actually matters.',
        impact: {
          metric: `db=${formatPercent(attribution.dbMs / total)},code=${formatPercent(attribution.codeMs / total)},outbound=${formatPercent(attribution.fetchMs / total)}`,
          humanized: `${formatPercent(dominantShare)} of the time is ${dominant.label}`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: attribution.spanIds.slice(0, 10), deepLink: '#/inspector' },
        fix: resolveFix('where-time-goes', routeSpans[0]?.framework ?? fallbackFramework, { routePattern }),
        sampleSize: stats.count
      })
    }
    return findings
  }
}
