import type { ChildSpan, RequestSpan } from '@apiscope/core'
import type { ResolvedAdvisorConfig } from './config'

export type FindingCategory =
  | 'performance'
  | 'payload'
  | 'caching'
  | 'database'
  | 'dependencies'
  | 'reliability'
  | 'code'

export type FindingSeverity = 'critical' | 'warning' | 'advisory'

export interface FindingImpact {
  metric: string
  humanized: string
}

export interface FindingScope {
  level: 'global' | 'route' | 'app'
  routePattern?: string
  appName?: string
}

export interface FindingEvidence {
  spanIds: string[]
  deepLink: string
}

export interface FindingFix {
  framework: string
  explanation: string
  codeSnippet?: string
  docsUrl?: string
}

export interface Finding {
  ruleId: string
  category: FindingCategory
  severity: FindingSeverity
  title: string
  whatAndWhy: string
  impact: FindingImpact
  scope: FindingScope
  evidence: FindingEvidence
  fix: FindingFix
  sampleSize: number
}

export interface AdvisorRouteStats {
  routePattern: string | null
  method: string
  count: number
  errorCount: number
  p50: number
  p95: number
  p99: number
}

export interface AdvisorApp {
  name: string
  framework: string
}

export interface AdvisorContext {
  spans: RequestSpan[]
  childSpans: ChildSpan[]
  routeStats: AdvisorRouteStats[]
  apps: AdvisorApp[]
  config: ResolvedAdvisorConfig
}

export interface AnalyzeResult {
  findings: Finding[]
  rulesRun: string[]
  insufficientData: boolean
}
