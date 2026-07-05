export interface TraceContext {
  traceId: string
  spanId: string
  sampled: boolean
}

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

export function formatTraceparent(context: TraceContext): string {
  const flags = context.sampled ? '01' : '00'
  return `00-${context.traceId}-${context.spanId}-${flags}`
}

export function parseTraceparent(header: string): TraceContext | null {
  const match = traceparentPattern.exec(header.trim())
  if (match === null) return null
  const traceId = match[1]!
  const spanId = match[2]!
  const flags = match[3]!
  if (traceId === '0'.repeat(32) || spanId === '0'.repeat(16)) return null
  return { traceId, spanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 }
}
