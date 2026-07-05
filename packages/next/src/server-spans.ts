import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AdapterRuntime, SpanContext } from '@apiscope/adapter-node'
import { matchRoutePattern } from './scanner'

interface PendingRequest {
  context: SpanContext
  startedAtWall: number
  startedAtHighRes: number
}

const internalPathPrefixes = ['/_next/', '/__nextjs', '/favicon.ico']

function isInternalPath(path: string): boolean {
  return internalPathPrefixes.some((prefix) => path.startsWith(prefix))
}

export function subscribeHttpServer(runtime: AdapterRuntime, getPatterns: () => string[]): () => void {
  const pending = new WeakMap<IncomingMessage, PendingRequest>()

  const onStart = (message: unknown) => {
    try {
      const { request } = message as { request: IncomingMessage }
      const path = (request.url ?? '/').split('?')[0] ?? '/'
      if (isInternalPath(path)) return
      const context = runtime.newIds()
      pending.set(request, { context, startedAtWall: Date.now(), startedAtHighRes: performance.now() })
      runtime.enterSpan(context)
    } catch {}
  }

  const onFinish = (message: unknown) => {
    try {
      const { request, response } = message as { request: IncomingMessage; response: ServerResponse }
      const entry = pending.get(request)
      if (entry === undefined) return
      pending.delete(request)
      const path = (request.url ?? '/').split('?')[0] ?? '/'
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined) continue
        headers[name] = Array.isArray(value) ? value.join(', ') : value
      }
      const requestPayload = runtime.capturePayload(headers, undefined)
      runtime.recordSpan({
        id: entry.context.spanId,
        traceId: entry.context.traceId,
        method: request.method ?? 'GET',
        routePattern: matchRoutePattern(getPatterns(), path),
        actualPath: path,
        statusCode: response.statusCode,
        timing: {
          start: entry.startedAtWall,
          ttfb: null,
          duration: performance.now() - entry.startedAtHighRes
        },
        framework: 'next',
        runtime: 'node',
        ...(requestPayload === undefined ? {} : { request: requestPayload })
      })
    } catch {}
  }

  subscribe('http.server.request.start', onStart)
  subscribe('http.server.response.finish', onFinish)
  return () => {
    unsubscribe('http.server.request.start', onStart)
    unsubscribe('http.server.response.finish', onFinish)
  }
}
