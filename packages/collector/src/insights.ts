import {
  analyze,
  resolveAdvisorConfig,
  type AdvisorApp,
  type AdvisorConfigInput,
  type AdvisorContext,
  type AdvisorRouteStats,
  type AnalyzeResult,
  type ResolvedAdvisorConfig
} from '@apiscope/advisor'
import type { ChildSpan, RequestSpan } from '@apiscope/core'
import type { SpanStore } from './store-interface'

export const INSIGHTS_RECENT_SPAN_WINDOW = 2000

export function resolveAdvisorConfigFromMeta(meta: unknown): ResolvedAdvisorConfig {
  if (meta !== null && typeof meta === 'object' && 'advisor' in meta) {
    const advisor = (meta as { advisor?: AdvisorConfigInput }).advisor
    return resolveAdvisorConfig(advisor)
  }
  return resolveAdvisorConfig()
}

function mostCommonFramework(spans: RequestSpan[]): string {
  const counts = new Map<string, number>()
  for (const span of spans) counts.set(span.framework, (counts.get(span.framework) ?? 0) + 1)
  let best = 'unknown'
  let bestCount = 0
  for (const [framework, count] of counts) {
    if (count > bestCount) {
      best = framework
      bestCount = count
    }
  }
  return best
}

export async function buildAdvisorContext(store: SpanStore, config: ResolvedAdvisorConfig): Promise<AdvisorContext> {
  const spans = await store.recentSpans(INSIGHTS_RECENT_SPAN_WINDOW)
  const childSpans: ChildSpan[] = []
  for (const span of spans) {
    const detail = await store.spanById(span.id)
    if (detail !== null && detail.childSpans.length > 0) childSpans.push(...detail.childSpans)
  }
  const rawStats = await store.routeStats()
  const routeStats: AdvisorRouteStats[] = rawStats.map((stats) => ({
    routePattern: stats.routePattern,
    method: stats.method,
    count: stats.count,
    errorCount: stats.errorCount,
    p50: stats.p50,
    p95: stats.p95,
    p99: stats.p99
  }))
  const registry = await store.listRoutes()
  const appNames = new Set(registry.map((entry) => entry.appName))
  const apps: AdvisorApp[] = [...appNames].map((name) => ({ name, framework: mostCommonFramework(spans) }))
  if (apps.length === 0 && spans.length > 0) apps.push({ name: 'app', framework: mostCommonFramework(spans) })
  return { spans, childSpans, routeStats, apps, config }
}

export async function computeInsights(store: SpanStore, config: ResolvedAdvisorConfig): Promise<AnalyzeResult & { windowSampleSize: number }> {
  const context = await buildAdvisorContext(store, config)
  const result = analyze(context)
  return { ...result, windowSampleSize: context.spans.length }
}
