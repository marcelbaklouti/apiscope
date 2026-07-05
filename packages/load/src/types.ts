export interface LoadTarget {
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
  weight?: number
  label?: string
}

export interface OpenPhase {
  durationMs: number
  rps: number
}

export type LoadModel =
  | { kind: 'open'; phases: OpenPhase[] }
  | { kind: 'closed'; concurrency: number; durationMs: number }

export interface LoadScenario {
  name: string
  baseUrl: string
  targets: LoadTarget[]
  model: LoadModel
  warmupMs?: number
  workers?: number
  allowRemoteHosts?: string[]
  hooksModule?: string
}

export interface SampleEntry {
  latencyMs: number
  statusCode: number
  targetIndex: number
  errorMessage?: string
  traceId?: string
}

export interface WorkerSampleMessage {
  type: 'samples'
  entries: SampleEntry[]
}

export interface WorkerDoneMessage {
  type: 'done'
  eventLoopLagP99Ms: number
  maxScheduleDeviationMs: number
  attempted: number
}

export interface WorkerErrorMessage {
  type: 'fatal'
  message: string
}

export type WorkerMessage = WorkerSampleMessage | WorkerDoneMessage | WorkerErrorMessage

export interface WorkerInput {
  scenario: LoadScenario
  workerIndex: number
  workerCount: number
  runId?: string
}

export interface LatencySummary {
  p50: number
  p90: number
  p95: number
  p99: number
  p999: number
  mean: number
  min: number
  max: number
}

export interface LoadRunResult {
  name: string
  runId: string
  aborted: boolean
  degraded: boolean
  totalRequests: number
  errorCount: number
  errorRate: number
  latency: LatencySummary
  statusDistribution: Record<string, number>
  perTarget: Array<{ label: string; count: number; p95: number }>
  targetRps: number | null
  achievedRps: number
  durationMs: number
  workerHealth: { eventLoopLagP99Ms: number; maxScheduleDeviationMs: number }
  generatedTraceIds: { count: number; sample: string[] }
}

export interface LoadAssertions {
  p50MaxMs?: number
  p95MaxMs?: number
  p99MaxMs?: number
  errorRateMax?: number
  achievedRpsMin?: number
}

export interface AssertionOutcome {
  name: string
  limit: number
  actual: number
  passed: boolean
}
