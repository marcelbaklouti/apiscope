import { AsyncLocalStorage } from 'node:async_hooks'
import {
  SpanBuffer,
  buildCapturedPayload,
  newSpanId,
  newTraceId,
  parseTraceparent,
  type CapturedPayload,
  type ChildSpan,
  type RequestSpan,
  type RouteRegistryEntry
} from '@apiscope/core'
import { instrumentDatabases } from './db/index'
import { CollectorTransport } from './transport'

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name]
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

export interface SpanContext {
  traceId: string
  spanId: string
}

export interface AdapterRuntimeOptions {
  appName: string
  framework: string
  collectorUrl?: string
  capture?: 'none' | 'headers' | 'full'
  additionalRedactedHeaders?: string[]
  transport?: CollectorTransport
}

export class AdapterRuntime {
  private readonly transport: CollectorTransport
  private readonly buffer: SpanBuffer
  private readonly storage = new AsyncLocalStorage<SpanContext>()
  private readonly capture: 'none' | 'headers' | 'full'
  private readonly additionalRedactedHeaders: string[]

  constructor(options: AdapterRuntimeOptions) {
    this.capture = options.capture ?? 'headers'
    this.additionalRedactedHeaders = options.additionalRedactedHeaders ?? []
    this.transport =
      options.transport ??
      new CollectorTransport({
        collectorUrl: options.collectorUrl ?? 'ws://127.0.0.1:4620',
        app: { name: options.appName, framework: options.framework, runtime: 'node', pid: process.pid }
      })
    this.buffer = new SpanBuffer({ onFlush: (batch) => this.transport.sendBatch(batch) })
  }

  start(): void {
    this.transport.start()
    instrumentDatabases(this)
  }

  setRoutes(routes: RouteRegistryEntry[]): void {
    this.transport.setRoutes(routes)
  }

  recordSpan(span: RequestSpan): void {
    this.buffer.pushSpan(span)
  }

  recordChildSpan(childSpan: ChildSpan): void {
    this.buffer.pushChildSpan(childSpan)
  }

  newIds(): SpanContext {
    return { traceId: newTraceId(), spanId: newSpanId() }
  }

  openSpanContext(headers: Record<string, string | string[] | undefined>): {
    traceId: string
    parentSpanId?: string
    loadRunId?: string
  } {
    const traceparentHeader = readHeader(headers, 'traceparent')
    const inbound = traceparentHeader === undefined ? null : parseTraceparent(traceparentHeader)
    const loadRun = readHeader(headers, 'apiscope-load-run')
    const result: { traceId: string; parentSpanId?: string; loadRunId?: string } = {
      traceId: inbound === null ? newTraceId() : inbound.traceId
    }
    if (inbound !== null) result.parentSpanId = inbound.spanId
    if (loadRun !== undefined) result.loadRunId = loadRun
    return result
  }

  runWithSpan<T>(context: SpanContext, fn: () => T): T {
    return this.storage.run(context, fn)
  }

  enterSpan(context: SpanContext): void {
    this.storage.enterWith(context)
  }

  currentSpan(): SpanContext | null {
    return this.storage.getStore() ?? null
  }

  capturePayload(headers: Record<string, string>, body: string | undefined): CapturedPayload | undefined {
    if (this.capture === 'none') return undefined
    const capturedBody = this.capture === 'full' ? body : undefined
    return buildCapturedPayload(headers, capturedBody, { additionalRedacted: this.additionalRedactedHeaders })
  }

  async shutdown(): Promise<void> {
    this.buffer.stop()
    await this.transport.stop()
  }
}
