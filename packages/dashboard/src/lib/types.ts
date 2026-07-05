import type { ChildSpan, RequestSpan, RouteRegistryEntry } from '@apiscope/core'
import type { LoadRunResult, LoadScenario } from '@apiscope/load'

export type Span = RequestSpan
export type Child = ChildSpan
export type RouteEntry = { appName: string } & RouteRegistryEntry

export interface RouteStatsEntry {
  routePattern: string | null
  method: string
  count: number
  errorCount: number
  p50: number
  p95: number
  p99: number
}

export interface RunSummary {
  id: string
  name: string
  startedAt: number
}

export interface RunDetail extends RunSummary {
  scenario: LoadScenario
  assertions: unknown
  result: LoadRunResult
}

export interface LoadProgress {
  totalRequests: number
  errorCount: number
  latencyP95: number
}
