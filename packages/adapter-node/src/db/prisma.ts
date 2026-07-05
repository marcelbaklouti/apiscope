import { createRequire } from 'node:module'
import { newSpanId, type DbChildSpan } from '@apiscope/core'
import { sqlOperationOf } from './emit'
import { getActiveRuntime } from './registry'

const require = createRequire(import.meta.url)

interface OtelReadableSpan {
  attributes: Record<string, unknown>
  startTime: [number, number]
  duration: [number, number]
}

interface OtelSpanProcessor {
  onStart(): void
  onEnd(span: OtelReadableSpan): void
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

function findAttribute(attributes: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = attributes[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function buildProcessor(): OtelSpanProcessor {
  return {
    onStart() {},
    onEnd(span: OtelReadableSpan) {
      const attributes = span.attributes
      const system = findAttribute(attributes, 'db.system.name', 'db.system')
      const statement = findAttribute(attributes, 'db.query.text', 'db.statement')
      if (system === undefined || statement === undefined) return
      const runtime = getActiveRuntime()
      const context = runtime?.currentSpan() ?? null
      if (runtime === null || context === null) return
      const operation = findAttribute(attributes, 'db.operation.name', 'db.operation') ?? sqlOperationOf(statement)
      const target = findAttribute(attributes, 'db.namespace', 'server.address') ?? null
      const [startSeconds, startNanos] = span.startTime
      const [durationSeconds, durationNanos] = span.duration
      const childSpan: DbChildSpan = {
        id: newSpanId(),
        parentSpanId: context.spanId,
        traceId: context.traceId,
        kind: 'db',
        system,
        statement,
        operation,
        target,
        rowCount: null,
        timing: {
          start: startSeconds * 1000 + startNanos / 1_000_000,
          ttfb: null,
          duration: durationSeconds * 1000 + durationNanos / 1_000_000
        }
      }
      runtime.recordChildSpan(childSpan)
    },
    forceFlush() {
      return Promise.resolve()
    },
    shutdown() {
      return Promise.resolve()
    }
  }
}

let registeredProcessor: OtelSpanProcessor | null = null

export function enablePrismaBridge(): void {
  if (registeredProcessor !== null) return
  const { BasicTracerProvider } = require('@opentelemetry/sdk-trace-base') as {
    BasicTracerProvider: new (config: { spanProcessors: OtelSpanProcessor[] }) => unknown
  }
  const { registerInstrumentations } = require('@opentelemetry/instrumentation') as {
    registerInstrumentations: (options: { instrumentations: unknown[]; tracerProvider: unknown }) => void
  }
  const { PrismaInstrumentation } = require('@prisma/instrumentation') as {
    PrismaInstrumentation: new () => unknown
  }
  registeredProcessor = buildProcessor()
  const provider = new BasicTracerProvider({ spanProcessors: [registeredProcessor] })
  registerInstrumentations({
    instrumentations: [new PrismaInstrumentation()],
    tracerProvider: provider
  })
}

export function getPrismaSpanProcessor(): OtelSpanProcessor | null {
  return registeredProcessor
}
