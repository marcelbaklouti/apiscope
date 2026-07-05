import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { randomUUID } from 'node:crypto'
import type { ChildSpan } from '@apiscope/core'
import type { AdapterRuntime, SpanContext } from './runtime'

interface UndiciRequest {
  origin: string | URL
  path: string
  method: string
}

interface TrackedRequest {
  context: SpanContext
  childSpanId: string
  url: string
  method: string
  startedAt: number
  startedAtHighRes: number
  ttfb: number | null
  statusCode: number | null
}

export function subscribeUndici(runtime: AdapterRuntime): () => void {
  const tracked = new WeakMap<object, TrackedRequest>()

  const finish = (request: object, error?: Error) => {
    const entry = tracked.get(request)
    if (entry === undefined) return
    tracked.delete(request)
    const childSpan: ChildSpan = {
      id: entry.childSpanId,
      parentSpanId: entry.context.spanId,
      traceId: entry.context.traceId,
      kind: 'fetch',
      url: entry.url,
      method: entry.method,
      statusCode: entry.statusCode,
      timing: { start: entry.startedAt, ttfb: entry.ttfb, duration: performance.now() - entry.startedAtHighRes }
    }
    if (error !== undefined) childSpan.error = { message: error.message }
    runtime.recordChildSpan(childSpan)
  }

  const onCreate = (message: unknown) => {
    try {
      const { request } = message as { request: UndiciRequest & object }
      const context = runtime.currentSpan()
      if (context === null) return
      tracked.set(request, {
        context,
        childSpanId: randomUUID(),
        url: `${String(request.origin)}${request.path}`,
        method: request.method,
        startedAt: Date.now(),
        startedAtHighRes: performance.now(),
        ttfb: null,
        statusCode: null
      })
    } catch {}
  }

  const onHeaders = (message: unknown) => {
    try {
      const { request, response } = message as { request: object; response: { statusCode: number } }
      const entry = tracked.get(request)
      if (entry === undefined) return
      entry.ttfb = performance.now() - entry.startedAtHighRes
      entry.statusCode = response.statusCode
    } catch {}
  }

  const onTrailers = (message: unknown) => {
    try {
      finish((message as { request: object }).request)
    } catch {}
  }

  const onError = (message: unknown) => {
    try {
      const { request, error } = message as { request: object; error: Error }
      finish(request, error)
    } catch {}
  }

  subscribe('undici:request:create', onCreate)
  subscribe('undici:request:headers', onHeaders)
  subscribe('undici:request:trailers', onTrailers)
  subscribe('undici:request:error', onError)
  return () => {
    unsubscribe('undici:request:create', onCreate)
    unsubscribe('undici:request:headers', onHeaders)
    unsubscribe('undici:request:trailers', onTrailers)
    unsubscribe('undici:request:error', onError)
  }
}
