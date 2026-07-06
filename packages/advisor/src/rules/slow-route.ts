import type { RequestSpan } from '@apiscope/core'
import type { AdvisorContext, Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeMs } from '../util/statement'

function spansForRoute(context: AdvisorContext, routePattern: string | null, method: string): RequestSpan[] {
  return context.spans.filter((span) => span.routePattern === routePattern && span.method === method)
}

function frameworkFor(spans: RequestSpan[], fallback: string): string {
  return spans[0]?.framework ?? fallback
}

export const slowRouteRule: Rule = {
  id: 'slow-route',
  category: 'performance',
  detect(context): Finding[] {
    const minSample = context.config.rules['slow-route']?.minimumSampleSize ?? 20
    const warnMs = context.config.thresholds.slowRouteP95Ms
    const criticalMs = context.config.thresholds.criticalRouteP95Ms
    const fallbackFramework = context.apps[0]?.framework ?? 'unknown'
    const findings: Finding[] = []
    for (const stats of context.routeStats) {
      if (stats.count < minSample || stats.p95 < warnMs) continue
      const routePattern = stats.routePattern ?? '(unmatched)'
      const routeSpans = spansForRoute(context, stats.routePattern, stats.method)
      const slowest = [...routeSpans].sort((left, right) => right.timing.duration - left.timing.duration)
      const severity = stats.p95 >= criticalMs ? 'critical' : 'warning'
      findings.push({
        ruleId: 'slow-route',
        category: 'performance',
        severity,
        title: `${stats.method} ${routePattern} is slow (p95 ${humanizeMs(stats.p95)})`,
        whatAndWhy: `Its 95th-percentile response time is over the ${humanizeMs(warnMs)} budget, so a noticeable share of requests are slow.`,
        impact: {
          metric: `p95=${Math.round(stats.p95)}ms`,
          humanized: `p95 ${Math.round(stats.p95)} ms means about 1 in 20 requests waits over ${humanizeMs(stats.p95)} — users feel that`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: slowest.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('slow-route', frameworkFor(routeSpans, fallbackFramework), { routePattern }),
        sampleSize: stats.count
      })
    }
    return findings
  }
}
