import type { ChildSpan, FetchChildSpan, RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeMs } from '../util/statement'

const OVERLAP_TOLERANCE_MS = 2

function isFetchChild(child: ChildSpan): child is FetchChildSpan {
  return child.kind === 'fetch'
}

export function nonOverlappingFetches(children: ChildSpan[], minDurationMs = 0): FetchChildSpan[] {
  const fetches = children.filter(isFetchChild).sort((left, right) => left.timing.start - right.timing.start)
  if (fetches.length < 2) return []
  for (const fetch of fetches) if (fetch.timing.duration < minDurationMs) return []
  for (let index = 1; index < fetches.length; index += 1) {
    const previous = fetches[index - 1]!
    const current = fetches[index]!
    const previousEnd = previous.timing.start + previous.timing.duration
    if (current.timing.start < previousEnd - OVERLAP_TOLERANCE_MS) return []
  }
  return fetches
}

function childrenByParent(childSpans: ChildSpan[]): Map<string, ChildSpan[]> {
  const map = new Map<string, ChildSpan[]>()
  for (const child of childSpans) map.set(child.parentSpanId, [...(map.get(child.parentSpanId) ?? []), child])
  return map
}

export const sequentialOutboundRule: Rule = {
  id: 'sequential-outbound',
  category: 'dependencies',
  detect(context): Finding[] {
    const minSample = context.config.rules['sequential-outbound']?.minimumSampleSize ?? 3
    const minDuration = context.config.thresholds.sequentialOutboundMinMs
    const byParent = childrenByParent(context.childSpans)
    const spansById = new Map(context.spans.map((span) => [span.id, span]))
    const affectedByRoute = new Map<string, { spans: RequestSpan[]; serialMs: number; count: number }>()
    for (const [parentSpanId, children] of byParent) {
      const parent = spansById.get(parentSpanId)
      if (parent === undefined || parent.routePattern === null) continue
      const fetches = nonOverlappingFetches(children, minDuration)
      if (fetches.length < 2) continue
      const serialMs = fetches.reduce((sum, fetch) => sum + fetch.timing.duration, 0)
      const key = `${parent.method} ${parent.routePattern}`
      const entry = affectedByRoute.get(key)
      if (entry === undefined) affectedByRoute.set(key, { spans: [parent], serialMs, count: fetches.length })
      else {
        entry.spans.push(parent)
        entry.serialMs = Math.max(entry.serialMs, serialMs)
        entry.count = Math.max(entry.count, fetches.length)
      }
    }
    const findings: Finding[] = []
    for (const [, entry] of affectedByRoute) {
      if (entry.spans.length < minSample) continue
      const parent = entry.spans[0]!
      const routePattern = parent.routePattern ?? '(unmatched)'
      findings.push({
        ruleId: 'sequential-outbound',
        category: 'dependencies',
        severity: 'warning',
        title: `Sequential outbound calls on ${parent.method} ${routePattern}`,
        whatAndWhy: 'This route makes independent outbound calls one after another, so their durations add up instead of overlapping.',
        impact: {
          metric: `serialFetches=${entry.count}`,
          humanized: `${entry.count} outbound calls run one after another (~${humanizeMs(entry.serialMs)} serial); running them together could cut this`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: entry.spans.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('sequential-outbound', parent.framework, { routePattern }),
        sampleSize: entry.spans.length
      })
    }
    return findings
  }
}
