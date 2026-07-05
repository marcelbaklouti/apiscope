import type { Context, Hono, MiddlewareHandler } from 'hono'
import {
  SpanBuffer,
  buildCapturedPayload,
  type CapturedPayload,
  type RequestSpan,
  type RouteRegistryEntry,
  type Runtime,
  type SpanBatchPayload,
  type SpanError
} from '@apiscope/core'
import { HttpCollectorTransport } from './transport'

export interface HonoAdapterOptions {
  appName: string
  collectorUrl?: string
  capture?: 'none' | 'headers' | 'full'
  additionalRedactedHeaders?: string[]
  mode?: 'batch' | 'immediate'
  transport?: HttpCollectorTransport
}

export function detectRuntime(): Runtime {
  const globals = globalThis as { Bun?: unknown; Deno?: unknown; navigator?: { userAgent?: string } }
  if (globals.Bun !== undefined) return 'bun'
  if (globals.Deno !== undefined) return 'deno'
  if (globals.navigator?.userAgent === 'Cloudflare-Workers') return 'edge'
  return 'node'
}

function generateId(): string {
  return crypto.randomUUID()
}

function routesFromApp(app: Hono): RouteRegistryEntry[] {
  const seen = new Set<string>()
  const entries: RouteRegistryEntry[] = []
  for (const route of app.routes) {
    if (route.method === 'ALL') continue
    const key = `${route.method} ${route.path}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ method: route.method, pattern: route.path })
  }
  return entries
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, name) => {
    record[name] = value
  })
  return record
}

function executionContextOf(c: Context): { waitUntil(promise: Promise<unknown>): void } | null {
  try {
    return c.executionCtx ?? null
  } catch {
    return null
  }
}

export function apiscopeHono(app: Hono, options: HonoAdapterOptions): { shutdown(): Promise<void> } {
  const runtime = detectRuntime()
  const capture = options.capture ?? 'headers'
  const transport =
    options.transport ??
    new HttpCollectorTransport({
      collectorUrl: options.collectorUrl ?? 'http://127.0.0.1:4620',
      app: { name: options.appName, framework: 'hono', runtime }
    })
  const buffer = new SpanBuffer({ onFlush: (batch: SpanBatchPayload) => void transport.sendBatch(batch) })

  const capturePayload = (headers: Record<string, string>): CapturedPayload | undefined => {
    if (capture === 'none') return undefined
    return buildCapturedPayload(headers, undefined, {
      additionalRedacted: options.additionalRedactedHeaders ?? []
    })
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    let handshakeWork: Promise<void> | null = null
    let deliveryWork: Promise<void> | null = null
    const executionContext = executionContextOf(c)
    const mode = options.mode ?? (executionContext === null ? 'batch' : 'immediate')
    try {
      handshakeWork = transport.ensureHandshake(routesFromApp(app))
    } catch {}
    const startedAtWall = Date.now()
    const startedAtHighRes = performance.now()
    let spanError: SpanError | undefined
    try {
      await next()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      spanError = { message, ...(stack === undefined ? {} : { stack }) }
      throw error
    } finally {
      try {
        if (spanError === undefined && c.error !== undefined) {
          const caught = c.error
          spanError = { message: caught.message, ...(caught.stack === undefined ? {} : { stack: caught.stack }) }
        }
        const path = new URL(c.req.url).pathname
        const requestPayload = capturePayload(headersToRecord(c.req.raw.headers))
        const span: RequestSpan = {
          id: generateId(),
          traceId: generateId(),
          method: c.req.method,
          routePattern: c.req.routePath === '*' ? null : c.req.routePath,
          actualPath: path,
          statusCode: spanError !== undefined ? 500 : (c.res?.status ?? 500),
          timing: { start: startedAtWall, ttfb: null, duration: performance.now() - startedAtHighRes },
          framework: 'hono',
          runtime,
          ...(spanError === undefined ? {} : { error: spanError }),
          ...(requestPayload === undefined ? {} : { request: requestPayload })
        }
        if (mode === 'immediate') {
          deliveryWork = transport.sendBatch({ spans: [span], childSpans: [], droppedCount: 0 })
        } else {
          buffer.pushSpan(span)
        }
        if (executionContext !== null) {
          if (handshakeWork !== null) executionContext.waitUntil(handshakeWork)
          if (deliveryWork !== null) executionContext.waitUntil(deliveryWork)
        }
      } catch {}
    }
  }

  app.use('*', middleware)

  return {
    async shutdown(): Promise<void> {
      let lastSend: Promise<void> = Promise.resolve()
      const originalSend = transport.sendBatch.bind(transport)
      transport.sendBatch = async (batch) => {
        lastSend = originalSend(batch)
        await lastSend
      }
      buffer.stop()
      transport.sendBatch = originalSend
      await lastSend
    }
  }
}
