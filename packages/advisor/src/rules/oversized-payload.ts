import type { RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeBytes, responseBytes } from '../util/statement'

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length === 0) return 0
  if (sorted.length % 2 === 1) return sorted[middle]!
  return Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

export const oversizedPayloadRule: Rule = {
  id: 'oversized-payload',
  category: 'payload',
  detect(context): Finding[] {
    const minSample = context.config.rules['oversized-payload']?.minimumSampleSize ?? 5
    const threshold = context.config.thresholds.oversizedPayloadBytes
    const byRoute = new Map<string, RequestSpan[]>()
    for (const span of context.spans) {
      if (span.routePattern === null) continue
      const bytes = responseBytes(span.response)
      if (bytes === null || bytes < threshold) continue
      byRoute.set(span.routePattern, [...(byRoute.get(span.routePattern) ?? []), span])
    }
    const findings: Finding[] = []
    for (const [routePattern, spans] of byRoute) {
      if (spans.length < minSample) continue
      const sizes = spans.map((span) => responseBytes(span.response) ?? 0)
      const medianBytes = median(sizes)
      if (medianBytes < threshold) continue
      const method = spans[0]!.method
      const framework = spans[0]!.framework
      findings.push({
        ruleId: 'oversized-payload',
        category: 'payload',
        severity: 'warning',
        title: `${method} ${routePattern} returns a large payload every call`,
        whatAndWhy:
          'This route returns a large JSON body on every request, which slows the response and increases memory and bandwidth for every client.',
        impact: { metric: `p50Bytes=${medianBytes}`, humanized: `~${humanizeBytes(medianBytes)} per response on ${routePattern}` },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: spans.slice(0, 10).map((span) => span.id), deepLink: '#/routes' },
        fix: resolveFix('oversized-payload', framework, { routePattern }),
        sampleSize: spans.length
      })
    }
    return findings
  }
}
