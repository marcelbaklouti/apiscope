import type { ChildSpan, RequestSpan, RouteRegistryEntry } from '@apiscope/core'

export interface RouteStats {
  routePattern: string | null
  method: string
  count: number
  errorCount: number
  p50: number
  p95: number
  p99: number
}

export interface StoredLoadRun {
  id: string
  name: string
  startedAt: number
  scenarioJson: string
  resultJson: string
}

export interface StoredLoadRunSummary {
  id: string
  name: string
  startedAt: number
}

export interface SpanStore {
  readonly recoveredFromCorruption: boolean
  insertBatch(appName: string, batch: { spans: RequestSpan[]; childSpans: ChildSpan[] }): Promise<void>
  replaceRoutes(appName: string, routes: RouteRegistryEntry[]): Promise<void>
  listRoutes(): Promise<Array<{ appName: string } & RouteRegistryEntry>>
  recentSpans(limit: number): Promise<RequestSpan[]>
  spansByLoadRun(loadRunId: string, limit: number): Promise<RequestSpan[]>
  spanById(id: string): Promise<{ span: RequestSpan; childSpans: ChildSpan[] } | null>
  routeStats(): Promise<RouteStats[]>
  insertLoadRun(run: StoredLoadRun): Promise<void>
  listLoadRuns(): Promise<StoredLoadRunSummary[]>
  loadRunById(id: string): Promise<StoredLoadRun | null>
  init(): Promise<void>
  close(): Promise<void>
}
