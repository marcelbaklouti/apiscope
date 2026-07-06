import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeMs } from '../util/statement'

export const unstableLatencyRule: Rule = {
  id: 'unstable-latency',
  category: 'performance',
  detect(context): Finding[] {
    const minSample = context.config.rules['unstable-latency']?.minimumSampleSize ?? 30
    const ratioThreshold = context.config.thresholds.unstableLatencyRatio
    const fallbackFramework = context.apps[0]?.framework ?? 'unknown'
    const findings: Finding[] = []
    for (const stats of context.routeStats) {
      if (stats.count < minSample || stats.p50 <= 0) continue
      const ratio = stats.p99 / stats.p50
      if (ratio < ratioThreshold) continue
      const routePattern = stats.routePattern ?? '(unmatched)'
      const routeSpans = context.spans.filter(
        (span) => span.routePattern === stats.routePattern && span.method === stats.method
      )
      const slowest = [...routeSpans].sort((left, right) => right.timing.duration - left.timing.duration)
      findings.push({
        ruleId: 'unstable-latency',
        category: 'performance',
        severity: ratio >= ratioThreshold * 2 ? 'warning' : 'advisory',
        title: `${stats.method} ${routePattern} has an unstable latency tail`,
        whatAndWhy: 'Most requests are fast but a minority hit a cliff, which shows up as a large gap between the median and the 99th percentile.',
        impact: {
          metric: `p99/p50=${ratio.toFixed(1)}`,
          humanized: `most requests finish in ~${humanizeMs(stats.p50)} but the slow tail hits ~${humanizeMs(stats.p99)}`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: slowest.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('unstable-latency', routeSpans[0]?.framework ?? fallbackFramework, { routePattern }),
        sampleSize: stats.count
      })
    }
    return findings
  }
}
