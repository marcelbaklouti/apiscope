import type { ChildSpan, DbChildSpan, RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeMs, normalizeStatement } from '../util/statement'

interface QueryGroup {
  template: string
  system: string
  count: number
  totalDurationMs: number
}

function isDbChild(child: ChildSpan): child is DbChildSpan {
  return child.kind === 'db'
}

export function detectNPlusOneGroups(childSpans: ChildSpan[]): QueryGroup[] {
  const groups = new Map<string, QueryGroup>()
  for (const child of childSpans) {
    if (!isDbChild(child)) continue
    const template = normalizeStatement(child.statement)
    const key = `${child.system}::${template}`
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, { template, system: child.system, count: 1, totalDurationMs: child.timing.duration })
    } else {
      existing.count += 1
      existing.totalDurationMs += child.timing.duration
    }
  }
  return [...groups.values()].filter((group) => group.count >= 2)
}

function childrenByParent(childSpans: ChildSpan[]): Map<string, ChildSpan[]> {
  const map = new Map<string, ChildSpan[]>()
  for (const child of childSpans) map.set(child.parentSpanId, [...(map.get(child.parentSpanId) ?? []), child])
  return map
}

export const nPlusOneRule: Rule = {
  id: 'n-plus-one',
  category: 'database',
  detect(context): Finding[] {
    const minSample = context.config.rules['n-plus-one']?.minimumSampleSize ?? 3
    const byParent = childrenByParent(context.childSpans)
    const spansById = new Map(context.spans.map((span) => [span.id, span]))
    const affectedByRoute = new Map<string, { spans: RequestSpan[]; worst: QueryGroup }>()
    for (const [parentSpanId, children] of byParent) {
      const parent = spansById.get(parentSpanId)
      if (parent === undefined || parent.routePattern === null) continue
      const groups = detectNPlusOneGroups(children).filter((group) => group.count >= 3)
      if (groups.length === 0) continue
      const worst = [...groups].sort(
        (left, right) => right.count * right.totalDurationMs - left.count * left.totalDurationMs
      )[0]!
      const key = `${parent.method} ${parent.routePattern}`
      const entry = affectedByRoute.get(key)
      if (entry === undefined) {
        affectedByRoute.set(key, { spans: [parent], worst })
      } else {
        entry.spans.push(parent)
        if (worst.count * worst.totalDurationMs > entry.worst.count * entry.worst.totalDurationMs) entry.worst = worst
      }
    }
    const findings: Finding[] = []
    for (const [, entry] of affectedByRoute) {
      if (entry.spans.length < minSample) continue
      const parent = entry.spans[0]!
      const routePattern = parent.routePattern ?? '(unmatched)'
      findings.push({
        ruleId: 'n-plus-one',
        category: 'database',
        severity: 'warning',
        title: `N+1 queries on ${parent.method} ${routePattern}`,
        whatAndWhy: 'Each request runs the same query once per row instead of fetching the related rows in a single query, multiplying database round-trips.',
        impact: {
          metric: `queries=${entry.worst.count}`,
          humanized: `~${entry.worst.count} repeated queries per request (~${humanizeMs(entry.worst.totalDurationMs)} total)`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: entry.spans.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('n-plus-one', parent.framework, { routePattern, system: entry.worst.system }),
        sampleSize: entry.spans.length
      })
    }
    return findings
  }
}
