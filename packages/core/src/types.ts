export type Runtime = 'node' | 'bun' | 'deno' | 'edge'

export interface SpanTiming {
  start: number
  ttfb: number | null
  duration: number
}

export interface SpanError {
  message: string
  digest?: string
  stack?: string
}

export interface CapturedPayload {
  headers: Record<string, string>
  body?: string
  truncated: boolean
  redactedHeaders: string[]
}

export interface RequestSpan {
  id: string
  traceId: string
  parentSpanId?: string
  loadRunId?: string
  method: string
  routePattern: string | null
  actualPath: string
  statusCode: number
  timing: SpanTiming
  framework: string
  runtime: Runtime
  error?: SpanError
  request?: CapturedPayload
  response?: CapturedPayload
}

interface ChildSpanBase {
  id: string
  parentSpanId: string
  traceId: string
  timing: SpanTiming
  error?: SpanError
}

export interface FetchChildSpan extends ChildSpanBase {
  kind: 'fetch'
  url: string
  method: string
  statusCode: number | null
}

export interface DbChildSpan extends ChildSpanBase {
  kind: 'db'
  system: string
  statement: string
  operation: string
  target: string | null
  rowCount: number | null
}

export type ChildSpan = FetchChildSpan | DbChildSpan

export interface RouteRegistryEntry {
  method: string
  pattern: string
  sourceFile?: string
}

export interface FlameNode {
  name: string
  file: string
  line: number
  value: number
  children: FlameNode[]
}
