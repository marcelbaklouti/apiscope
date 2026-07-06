import { capBody, newSpanId, type DbChildSpan } from '@apiscope/core'
import { getActiveRuntime } from './registry'

interface DbSpanDescriptor {
  system: string
  statement: string
  operation: string
  target: string | null
}

export interface EmitDbSpanInput<T> extends DbSpanDescriptor {
  run: () => T
  rowCountOf?: (result: T) => number | null
}

export interface EmitDbSpanAsyncInput<T> extends DbSpanDescriptor {
  run: () => Promise<T>
  rowCountOf?: (result: T) => number | null
}

function buildChildSpan(
  descriptor: DbSpanDescriptor,
  spanId: string,
  parentSpanId: string,
  traceId: string,
  rowCount: number | null,
  error: Error | undefined,
  startedAt: number,
  startedAtHighRes: number
): DbChildSpan {
  const childSpan: DbChildSpan = {
    id: spanId,
    parentSpanId,
    traceId,
    kind: 'db',
    system: descriptor.system,
    statement: capBody(descriptor.statement).body,
    operation: descriptor.operation,
    target: descriptor.target,
    rowCount,
    timing: { start: startedAt, ttfb: null, duration: performance.now() - startedAtHighRes }
  }
  if (error !== undefined) {
    childSpan.error = { message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) }
  }
  return childSpan
}

export function emitDbSpan<T>(input: EmitDbSpanInput<T>): T {
  const runtime = getActiveRuntime()
  const context = runtime?.currentSpan() ?? null
  if (runtime === null || context === null) return input.run()
  const startedAt = Date.now()
  const startedAtHighRes = performance.now()
  try {
    const result = input.run()
    const rowCount = input.rowCountOf?.(result) ?? null
    runtime.recordChildSpan(
      buildChildSpan(input, newSpanId(), context.spanId, context.traceId, rowCount, undefined, startedAt, startedAtHighRes)
    )
    return result
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    runtime.recordChildSpan(
      buildChildSpan(input, newSpanId(), context.spanId, context.traceId, null, normalized, startedAt, startedAtHighRes)
    )
    throw error
  }
}

export function sqlOperationOf(statement: string): string {
  const match = statement.trim().match(/^[a-zA-Z]+/)
  return match === null ? '' : match[0].toUpperCase()
}

export async function emitDbSpanAsync<T>(input: EmitDbSpanAsyncInput<T>): Promise<T> {
  const runtime = getActiveRuntime()
  const context = runtime?.currentSpan() ?? null
  if (runtime === null || context === null) return input.run()
  const startedAt = Date.now()
  const startedAtHighRes = performance.now()
  try {
    const result = await input.run()
    const rowCount = input.rowCountOf?.(result) ?? null
    runtime.recordChildSpan(
      buildChildSpan(input, newSpanId(), context.spanId, context.traceId, rowCount, undefined, startedAt, startedAtHighRes)
    )
    return result
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    runtime.recordChildSpan(
      buildChildSpan(input, newSpanId(), context.spanId, context.traceId, null, normalized, startedAt, startedAtHighRes)
    )
    throw error
  }
}
