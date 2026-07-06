import type { ChildSpan, RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { formatPercent, humanizeMs, normalizeStatement } from '../util/statement'

const MINIMUM_DEPENDENCY_MS = 20

interface AffectedGroup {
  spans: RequestSpan[]
  totalChildMs: number
  totalShare: number
  label: string
  system: string
}

function dependencyIdentity(child: ChildSpan): { key: string; label: string; system: string } {
  if (child.kind === 'db') {
    const template = normalizeStatement(child.statement)
    return { key: `db::${child.system}::${template}`, label: `${child.system} query`, system: child.system }
  }
  let host = child.url
  try {
    host = new URL(child.url).host
  } catch {
    host = child.url
  }
  return { key: `fetch::${host}`, label: `call to ${host}`, system: 'http' }
}

function slowestChild(children: ChildSpan[]): ChildSpan | null {
  if (children.length === 0) return null
  return [...children].sort((left, right) => right.timing.duration - left.timing.duration)[0]!
}

function childrenByParent(childSpans: ChildSpan[]): Map<string, ChildSpan[]> {
  const map = new Map<string, ChildSpan[]>()
  for (const child of childSpans) map.set(child.parentSpanId, [...(map.get(child.parentSpanId) ?? []), child])
  return map
}

export const slowDependencyRule: Rule = {
  id: 'slow-dependency',
  category: 'dependencies',
  detect(context): Finding[] {
    const minSample = context.config.rules['slow-dependency']?.minimumSampleSize ?? 10
    const shareThreshold = context.config.thresholds.slowDependencyShare
    const byParent = childrenByParent(context.childSpans)
    const spansById = new Map(context.spans.map((span) => [span.id, span]))
    const groups = new Map<string, AffectedGroup>()
    for (const [parentSpanId, children] of byParent) {
      const parent = spansById.get(parentSpanId)
      if (parent === undefined || parent.routePattern === null || parent.timing.duration <= 0) continue
      const child = slowestChild(children)
      if (child === null || child.timing.duration < MINIMUM_DEPENDENCY_MS) continue
      const share = child.timing.duration / parent.timing.duration
      if (share < shareThreshold) continue
      const identity = dependencyIdentity(child)
      const key = `${parent.method} ${parent.routePattern}::${identity.key}`
      const entry = groups.get(key)
      if (entry === undefined) {
        groups.set(key, { spans: [parent], totalChildMs: child.timing.duration, totalShare: share, label: identity.label, system: identity.system })
      } else {
        entry.spans.push(parent)
        entry.totalChildMs += child.timing.duration
        entry.totalShare += share
      }
    }
    const findings: Finding[] = []
    for (const [, entry] of groups) {
      if (entry.spans.length < minSample) continue
      const parent = entry.spans[0]!
      const routePattern = parent.routePattern ?? '(unmatched)'
      const avgChildMs = entry.totalChildMs / entry.spans.length
      const avgShare = entry.totalShare / entry.spans.length
      findings.push({
        ruleId: 'slow-dependency',
        category: 'dependencies',
        severity: 'warning',
        title: `Slow ${entry.label} on ${parent.method} ${routePattern}`,
        whatAndWhy: 'A single query or outbound call takes the majority of this route\'s time, so it is the one thing worth optimizing first.',
        impact: {
          metric: `share=${formatPercent(avgShare)},ms=${Math.round(avgChildMs)}`,
          humanized: `one ${entry.label} takes ~${formatPercent(avgShare)} of ${routePattern}'s time (~${humanizeMs(avgChildMs)})`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: entry.spans.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('slow-dependency', parent.framework, { routePattern, system: entry.system }),
        sampleSize: entry.spans.length
      })
    }
    return findings
  }
}
