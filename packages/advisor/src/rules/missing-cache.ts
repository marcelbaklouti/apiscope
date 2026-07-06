import type { RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { headerValue } from '../util/statement'

function lacksCacheHeaders(span: RequestSpan): boolean {
  if (span.method !== 'GET' || span.statusCode !== 200 || span.response === undefined) return false
  const cacheControl = headerValue(span.response.headers, 'cache-control')
  const etag = headerValue(span.response.headers, 'etag')
  return cacheControl === undefined && etag === undefined
}

function hasRepeatedPath(spans: RequestSpan[]): boolean {
  const counts = new Map<string, number>()
  for (const span of spans) counts.set(span.actualPath, (counts.get(span.actualPath) ?? 0) + 1)
  for (const count of counts.values()) if (count >= 2) return true
  return false
}

export const missingCacheHeadersRule: Rule = {
  id: 'missing-cache-headers',
  category: 'caching',
  detect(context): Finding[] {
    const minSample = context.config.rules['missing-cache-headers']?.minimumSampleSize ?? 5
    const offenders = context.spans.filter(lacksCacheHeaders)
    if (offenders.length === 0) return []
    const byRoute = new Map<string, RequestSpan[]>()
    for (const span of offenders) {
      if (span.routePattern === null) continue
      const key = span.routePattern
      byRoute.set(key, [...(byRoute.get(key) ?? []), span])
    }
    const findings: Finding[] = []
    for (const [routePattern, spans] of byRoute) {
      if (spans.length < minSample || !hasRepeatedPath(spans)) continue
      const framework = spans[0]!.framework
      findings.push({
        ruleId: 'missing-cache-headers',
        category: 'caching',
        severity: 'advisory',
        title: `GET ${routePattern} is cacheable but has no cache headers`,
        whatAndWhy:
          'The same GET is requested repeatedly and returns 200 with no cache-control or etag, so clients and proxies cannot reuse the response.',
        impact: { metric: `repeatedGets=${spans.length}`, humanized: `${spans.length} identical GETs with no cache-control or etag` },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: spans.slice(0, 10).map((span) => span.id), deepLink: '#/routes' },
        fix: resolveFix('missing-cache-headers', framework, { routePattern }),
        sampleSize: spans.length
      })
    }
    return findings
  }
}
