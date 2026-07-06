import type { RequestSpan } from '@apiscope/core'
import type { Finding, FindingSeverity } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { formatPercent } from '../util/statement'

export const errorHotspotRule: Rule = {
  id: 'error-hotspot',
  category: 'reliability',
  detect(context): Finding[] {
    const minSample = context.config.rules['error-hotspot']?.minimumSampleSize ?? 20
    const warnRate = context.config.thresholds.errorRateWarning
    const criticalRate = context.config.thresholds.errorRateCritical
    const clientRateFloor = Math.max(0.25, warnRate * 10)
    const fallbackFramework = context.apps[0]?.framework ?? 'unknown'
    const findings: Finding[] = []
    for (const stats of context.routeStats) {
      if (stats.count < minSample) continue
      const routeSpans = context.spans.filter(
        (span) => span.routePattern === stats.routePattern && span.method === stats.method
      )
      const clientErrors = routeSpans.filter((span) => span.statusCode >= 400 && span.statusCode < 500).length
      const serverErrorRate = stats.errorCount / stats.count
      const clientErrorRate = routeSpans.length === 0 ? 0 : clientErrors / routeSpans.length
      const serverTriggered = serverErrorRate >= warnRate
      const clientTriggered = clientErrorRate >= clientRateFloor
      if (!serverTriggered && !clientTriggered) continue
      const rate = serverTriggered ? serverErrorRate : clientErrorRate
      const family = serverTriggered ? '5xx' : '4xx'
      const severity: FindingSeverity = serverTriggered && serverErrorRate >= criticalRate ? 'critical' : 'warning'
      const routePattern = stats.routePattern ?? '(unmatched)'
      const failing = routeSpans.filter((span) => span.statusCode >= 400)
      findings.push({
        ruleId: 'error-hotspot',
        category: 'reliability',
        severity,
        title: `Errors on ${stats.method} ${routePattern}`,
        whatAndWhy: `This route returns ${family} errors more often than expected, so a real share of requests are failing.`,
        impact: { metric: `errorRate=${formatPercent(rate)}`, humanized: `${formatPercent(rate)} of requests to ${routePattern} return ${family} errors` },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: failing.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('error-hotspot', routeSpans[0]?.framework ?? fallbackFramework, { routePattern }),
        sampleSize: stats.count
      })
    }
    return findings
  }
}
