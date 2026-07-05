import type { AppMetadata, ChildSpan, RequestSpan, RouteRegistryEntry } from '@apiscope/core'

export type LiveEvent =
  | { type: 'spans'; appName: string; spans: RequestSpan[]; childSpans: ChildSpan[] }
  | { type: 'registry'; appName: string; routes: RouteRegistryEntry[] }
  | { type: 'app-connected'; app: AppMetadata }
  | { type: 'app-disconnected'; appName: string }
  | { type: 'dropped'; appName: string; droppedCount: number }
  | {
      type: 'load-progress'
      runId: string
      name: string
      snapshot: { totalRequests: number; errorCount: number; latencyP95: number }
    }
  | { type: 'load-finished'; runId: string; ok: boolean }
