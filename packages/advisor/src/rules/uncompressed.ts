import type { RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { formatPercent, headerValue, humanizeBytes, isTextyContentType, responseBytes } from '../util/statement'

const COMPRESSED_ENCODINGS = new Set(['gzip', 'br', 'deflate'])

function isUncompressedTextyOffender(span: RequestSpan, minBytes: number): boolean {
  if (span.response === undefined) return false
  const contentType = headerValue(span.response.headers, 'content-type')
  if (!isTextyContentType(contentType)) return false
  const bytes = responseBytes(span.response)
  if (bytes === null || bytes < minBytes) return false
  const encoding = headerValue(span.response.headers, 'content-encoding')?.toLowerCase()
  if (encoding !== undefined && COMPRESSED_ENCODINGS.has(encoding)) return false
  return true
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best = values[0] ?? 'unknown'
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

export const uncompressedResponsesRule: Rule = {
  id: 'uncompressed-responses',
  category: 'payload',
  detect(context): Finding[] {
    const minSample = context.config.rules['uncompressed-responses']?.minimumSampleSize ?? 5
    const minBytes = context.config.thresholds.compressibleMinBytes
    const offenders = context.spans.filter((span) => isUncompressedTextyOffender(span, minBytes))
    if (offenders.length === 0) return []
    const byRoute = new Map<string, RequestSpan[]>()
    for (const span of offenders) {
      const key = span.routePattern ?? span.actualPath
      byRoute.set(key, [...(byRoute.get(key) ?? []), span])
    }
    const qualifyingRoutes = [...byRoute.entries()].filter(([, spans]) => spans.length >= minSample)
    if (qualifyingRoutes.length === 0) return []
    const qualifyingSpans = qualifyingRoutes.flatMap(([, spans]) => spans)
    const totalBytes = qualifyingSpans.reduce((sum, span) => sum + (responseBytes(span.response) ?? 0), 0)
    const meanBytes = Math.round(totalBytes / qualifyingSpans.length)
    const framework = mostCommon(qualifyingSpans.map((span) => span.framework))
    const trafficPct = formatPercent(qualifyingSpans.length / Math.max(context.spans.length, 1))
    return [
      {
        ruleId: 'uncompressed-responses',
        category: 'payload',
        severity: 'warning',
        title: `${qualifyingRoutes.length} route${qualifyingRoutes.length === 1 ? '' : 's'} send uncompressed responses`,
        whatAndWhy:
          'Text responses over ~1.4 KB are sent without gzip or brotli, so clients download several times more bytes than they need to.',
        impact: {
          metric: `avgBytes=${meanBytes}`,
          humanized: `~${humanizeBytes(meanBytes)} to ~${humanizeBytes(Math.round(meanBytes * 0.2))} · affects ${trafficPct} of traffic`
        },
        scope: { level: 'global' },
        evidence: { spanIds: qualifyingSpans.slice(0, 10).map((span) => span.id), deepLink: '#/routes' },
        fix: resolveFix('uncompressed-responses', framework),
        sampleSize: qualifyingSpans.length
      }
    ]
  }
}
