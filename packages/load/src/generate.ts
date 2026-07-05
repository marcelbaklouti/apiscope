import type { RequestSpan } from '@apiscope/core'
import type { LoadAssertions, LoadScenario, LoadTarget } from './types'

export interface GenerateScenarioInput {
  spans: RequestSpan[]
  baseUrl: string
  durationMs?: number
  connections?: number
  shape?: 'steady' | 'ramp'
}

export interface RouteAssertionBudget {
  pattern: string
  method: string
  maxP95Ms: number
}

export interface GeneratedAssertions extends LoadAssertions {
  perRoute: RouteAssertionBudget[]
}

export interface GeneratedScenario {
  scenario: LoadScenario
  assertions: GeneratedAssertions
  observed: { totalRequests: number; windowMs: number; averageRps: number; peakRps: number }
}

const defaultDurationMs = 60000
const warmupSharePct = 0.25
const bodyCarryingMethods = new Set(['POST', 'PUT', 'PATCH', 'QUERY'])

function exactRankPercentile(valuesMs: number[], quantile: number): number {
  if (valuesMs.length === 0) return 0
  const sorted = [...valuesMs].sort((a, b) => a - b)
  const offset = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)
  return sorted[Math.max(0, offset)] ?? 0
}

function groupKey(span: RequestSpan): string {
  return `${span.method} ${span.routePattern ?? span.actualPath}`
}

function computePeakRps(spans: RequestSpan[]): number {
  if (spans.length === 0) return 0
  const countBySecond = new Map<number, number>()
  for (const span of spans) {
    const bucket = Math.floor(span.timing.start / 1000)
    countBySecond.set(bucket, (countBySecond.get(bucket) ?? 0) + 1)
  }
  return Math.max(...countBySecond.values())
}

function representativeBody(spans: RequestSpan[], method: string): string | undefined {
  if (!bodyCarryingMethods.has(method)) return undefined
  const withBody = [...spans].sort((a, b) => b.timing.start - a.timing.start).find((span) => span.request?.body !== undefined)
  return withBody?.request?.body
}

function buildTarget(spans: RequestSpan[], totalRequests: number): LoadTarget {
  const mostRecent = spans.reduce((latest, span) => (span.timing.start > latest.timing.start ? span : latest))
  const body = representativeBody(spans, mostRecent.method)
  return {
    method: mostRecent.method,
    path: mostRecent.actualPath,
    weight: spans.length / totalRequests,
    ...(body === undefined ? {} : { body })
  }
}

function buildRouteBudget(pattern: string, method: string, spans: RequestSpan[]): RouteAssertionBudget {
  const durations = spans.map((span) => span.timing.duration)
  return { pattern, method, maxP95Ms: exactRankPercentile(durations, 0.95) }
}

export function generateScenario(input: GenerateScenarioInput): GeneratedScenario {
  const shape = input.shape ?? 'steady'
  const durationMs = input.durationMs ?? defaultDurationMs
  const totalRequests = input.spans.length

  if (totalRequests === 0) {
    return {
      scenario: {
        name: 'observed-traffic',
        baseUrl: input.baseUrl,
        targets: [],
        model: { kind: 'open', phases: [{ durationMs, rps: 0 }] },
        ...(input.connections === undefined ? {} : { workers: input.connections })
      },
      assertions: { perRoute: [] },
      observed: { totalRequests: 0, windowMs: 0, averageRps: 0, peakRps: 0 }
    }
  }

  const startTimes = input.spans.map((span) => span.timing.start)
  const windowMs = Math.max(0, Math.max(...startTimes) - Math.min(...startTimes))
  const windowSeconds = windowMs / 1000
  const averageRps = windowSeconds > 0 ? totalRequests / windowSeconds : totalRequests
  const peakRps = computePeakRps(input.spans)

  const groups = new Map<string, RequestSpan[]>()
  for (const span of input.spans) {
    const key = groupKey(span)
    const existing = groups.get(key)
    if (existing === undefined) groups.set(key, [span])
    else existing.push(span)
  }

  const targets: LoadTarget[] = []
  const perRoute: RouteAssertionBudget[] = []
  for (const spans of groups.values()) {
    const firstSpan = spans[0]
    if (firstSpan === undefined) continue
    targets.push(buildTarget(spans, totalRequests))
    const pattern = firstSpan.routePattern ?? firstSpan.actualPath
    perRoute.push(buildRouteBudget(pattern, firstSpan.method, spans))
  }

  const model: LoadScenario['model'] =
    shape === 'steady'
      ? { kind: 'open', phases: [{ durationMs, rps: Math.round(averageRps) }] }
      : {
          kind: 'open',
          phases: [
            { durationMs: Math.round(durationMs * warmupSharePct), rps: Math.round(peakRps) },
            { durationMs: Math.round(durationMs * (1 - warmupSharePct)), rps: Math.round(averageRps) }
          ]
        }

  const errorCount = input.spans.filter((span) => span.statusCode >= 500 || span.error !== undefined).length

  return {
    scenario: {
      name: 'observed-traffic',
      baseUrl: input.baseUrl,
      targets,
      model,
      ...(input.connections === undefined ? {} : { workers: input.connections })
    },
    assertions: {
      p95MaxMs: exactRankPercentile(
        input.spans.map((span) => span.timing.duration),
        0.95
      ),
      errorRateMax: totalRequests === 0 ? 0 : errorCount / totalRequests,
      perRoute
    },
    observed: { totalRequests, windowMs, averageRps, peakRps }
  }
}
