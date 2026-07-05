import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import {
  SpanBuffer,
  buildCapturedPayload,
  type CapturedPayload,
  type ChildSpan,
  type RequestSpan,
  type RouteRegistryEntry
} from '@apiscope/core'
import { CollectorTransport } from './transport'

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
    return { traceId: randomUUID(), spanId: randomUUID() }
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
