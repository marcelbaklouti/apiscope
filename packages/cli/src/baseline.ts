import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LoadRunResult } from '@apiscope/load'

export interface BaselineScenarioMetrics {
  p50: number
  p95: number
  p99: number
  errorRate: number
  achievedRps: number
}

export interface BaselineFile {
  version: 1
  createdAt: string
  scenarios: Record<string, BaselineScenarioMetrics>
  routes: Array<{ appName: string; method: string; pattern: string }>
}

export interface DiffTolerances {
  p50Pct?: number
  p95Pct?: number
  p99Pct?: number
  errorRateAbs?: number
}

export interface DiffOutcome {
  name: string
  baseline: number
  actual: number
  limit: number
  passed: boolean
}

export interface RouteDrift {
  added: Array<{ appName: string; method: string; pattern: string }>
  removed: Array<{ appName: string; method: string; pattern: string }>
}

export function readBaseline(path: string): BaselineFile | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as BaselineFile
}

export function writeBaseline(path: string, baseline: BaselineFile): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`)
}

export function baselineFromResults(
  results: Array<{ name: string; result: LoadRunResult }>,
  routes: BaselineFile['routes']
): BaselineFile {
  const scenarios: Record<string, BaselineScenarioMetrics> = {}
  for (const entry of results) {
    scenarios[entry.name] = {
      p50: entry.result.latency.p50,
      p95: entry.result.latency.p95,
      p99: entry.result.latency.p99,
      errorRate: entry.result.errorRate,
      achievedRps: entry.result.achievedRps
    }
  }
  return { version: 1, createdAt: new Date().toISOString(), scenarios, routes }
}

export function diffAgainstBaseline(
  name: string,
  result: LoadRunResult,
  baseline: BaselineFile,
  tolerances: DiffTolerances
): DiffOutcome[] {
  const reference = baseline.scenarios[name]
  if (reference === undefined) return []
  const outcomes: DiffOutcome[] = []
  const percentChecks: Array<{ key: 'p50Pct' | 'p95Pct' | 'p99Pct'; label: string; baselineValue: number; actual: number }> = [
    { key: 'p50Pct', label: 'p50', baselineValue: reference.p50, actual: result.latency.p50 },
    { key: 'p95Pct', label: 'p95', baselineValue: reference.p95, actual: result.latency.p95 },
    { key: 'p99Pct', label: 'p99', baselineValue: reference.p99, actual: result.latency.p99 }
  ]
  for (const check of percentChecks) {
    const tolerance = tolerances[check.key]
    if (tolerance === undefined) continue
    const limit = check.baselineValue * (1 + tolerance / 100)
    outcomes.push({
      name: `${check.label} vs baseline (+${tolerance}%)`,
      baseline: check.baselineValue,
      actual: check.actual,
      limit,
      passed: check.actual <= limit
    })
  }
  if (tolerances.errorRateAbs !== undefined) {
    const limit = reference.errorRate + tolerances.errorRateAbs
    outcomes.push({
      name: `errorRate vs baseline (+${tolerances.errorRateAbs})`,
      baseline: reference.errorRate,
      actual: result.errorRate,
      limit,
      passed: result.errorRate <= limit
    })
  }
  return outcomes
}

function routeKey(route: { appName: string; method: string; pattern: string }): string {
  return `${route.appName} ${route.method} ${route.pattern}`
}

export function detectRouteDrift(baseline: BaselineFile, currentRoutes: BaselineFile['routes']): RouteDrift {
  const baselineKeys = new Set(baseline.routes.map(routeKey))
  const currentKeys = new Set(currentRoutes.map(routeKey))
  return {
    added: currentRoutes.filter((route) => !baselineKeys.has(routeKey(route))),
    removed: baseline.routes.filter((route) => !currentKeys.has(routeKey(route)))
  }
}
