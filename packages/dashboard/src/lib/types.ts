import type { ChildSpan, RequestSpan, RouteRegistryEntry } from '@apiscope/core'
import type { GeneratedScenario, LoadRunResult, LoadScenario } from '@apiscope/load'

export type { GeneratedScenario }

export type Span = RequestSpan
export type Child = ChildSpan
export type RouteEntry = { appName: string; nPlusOneRequests: number } & RouteRegistryEntry

export interface NPlusOneGroup {
  system: string
  template: string
  count: number
  totalDurationMs: number
}

export interface SpanDetail {
  span: Span
  childSpans: Child[]
  nPlusOne: NPlusOneGroup[]
}

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

export interface FlameNode {
  name: string
  file: string
  line: number
  value: number
  children: FlameNode[]
}

export interface StoredProfile {
  id: string
  appName: string
  capturedAt: number
  flamegraph: FlameNode
}

export interface DependencyNode {
  id: string
  kind: 'route' | 'db' | 'http'
  label: string
}

export interface DependencyEdge {
  from: string
  to: string
  count: number
  p95Ms: number
}

export interface DependencyGraph {
  nodes: DependencyNode[]
  edges: DependencyEdge[]
}

export type FindingCategory =
  | 'performance'
  | 'payload'
  | 'caching'
  | 'database'
  | 'dependencies'
  | 'reliability'
  | 'code'
export type FindingSeverity = 'critical' | 'warning' | 'advisory'

export interface Finding {
  ruleId: string
  category: FindingCategory
  severity: FindingSeverity
  title: string
  whatAndWhy: string
  impact: { metric: string; humanized: string }
  scope: { level: 'global' | 'route' | 'app'; routePattern?: string; appName?: string }
  evidence: { spanIds: string[]; deepLink: string }
  fix: { framework: string; explanation: string; codeSnippet?: string; docsUrl?: string }
  sampleSize: number
}

export interface InsightsResponse {
  findings: Finding[]
  rulesRun: string[]
  insufficientData: boolean
  advisorEnabled: boolean
  windowSampleSize: number
  error?: string
}
