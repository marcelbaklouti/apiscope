import fastifyPlugin from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { newSpanId, type RouteRegistryEntry, type SpanError } from '@apiscope/core'
import { AdapterRuntime, subscribeUndici, type AdapterRuntimeOptions, type SpanContext } from '@apiscope/adapter-node'

export type FastifyAdapterOptions = Omit<AdapterRuntimeOptions, 'framework' | 'transport'> & {
  runtime?: AdapterRuntime
}

interface PendingSpan {
  context: SpanContext
  parentSpanId?: string
  loadRunId?: string
  startedAtWall: number
  error?: SpanError
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const flattened: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    flattened[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return flattened
}

async function plugin(app: FastifyInstance, options: FastifyAdapterOptions): Promise<void> {
  const runtime =
    options.runtime ??
    new AdapterRuntime({
      appName: options.appName,
      framework: 'fastify',
      ...(options.collectorUrl === undefined ? {} : { collectorUrl: options.collectorUrl }),
      ...(options.capture === undefined ? {} : { capture: options.capture }),
      ...(options.additionalRedactedHeaders === undefined
        ? {}
        : { additionalRedactedHeaders: options.additionalRedactedHeaders })
    })
  runtime.start()
  subscribeUndici(runtime)
  const routes: RouteRegistryEntry[] = []
  const pendingSpans = new WeakMap<FastifyRequest, PendingSpan>()

  app.addHook('onRoute', (routeOptions) => {
    try {
      const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method]
      for (const method of methods) {
        if (method === 'HEAD') continue
        routes.push({ method, pattern: routeOptions.url })
      }
    } catch {}
  })

  app.addHook('onReady', async () => {
    try {
      runtime.setRoutes(routes)
    } catch {}
  })

  app.addHook('onRequest', async (request) => {
    try {
      const spanContext = runtime.openSpanContext(request.headers as Record<string, string | string[] | undefined>)
      const context = { traceId: spanContext.traceId, spanId: newSpanId() }
      pendingSpans.set(request, {
        context,
        startedAtWall: Date.now(),
        ...(spanContext.parentSpanId === undefined ? {} : { parentSpanId: spanContext.parentSpanId }),
        ...(spanContext.loadRunId === undefined ? {} : { loadRunId: spanContext.loadRunId })
      })
      runtime.enterSpan(context)
    } catch {}
  })

  app.addHook('onError', async (request, reply, error) => {
    try {
      const pending = pendingSpans.get(request)
      if (pending === undefined) return
      pending.error = { message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) }
    } catch {}
  })

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const pending = pendingSpans.get(request)
      if (pending === undefined) return
      pendingSpans.delete(request)
      const requestPayload = runtime.capturePayload(
        flattenHeaders(request.headers as Record<string, string | string[] | undefined>),
        request.body === undefined ? undefined : JSON.stringify(request.body)
      )
      const responsePayload = runtime.capturePayload(
        flattenHeaders(reply.getHeaders() as Record<string, string | string[] | undefined>),
        undefined
      )
      runtime.recordSpan({
        id: pending.context.spanId,
        traceId: pending.context.traceId,
        method: request.method,
        routePattern: request.routeOptions.url ?? null,
        actualPath: request.url.split('?')[0] ?? request.url,
        statusCode: reply.statusCode,
        timing: { start: pending.startedAtWall, ttfb: null, duration: reply.elapsedTime },
        framework: 'fastify',
        runtime: 'node',
        ...(pending.parentSpanId === undefined ? {} : { parentSpanId: pending.parentSpanId }),
        ...(pending.loadRunId === undefined ? {} : { loadRunId: pending.loadRunId }),
        ...(pending.error === undefined ? {} : { error: pending.error }),
        ...(requestPayload === undefined ? {} : { request: requestPayload }),
        ...(responsePayload === undefined ? {} : { response: responsePayload })
      })
    } catch {}
  })

  app.addHook('onClose', async () => {
    if (options.runtime === undefined) await runtime.shutdown()
  })
}

export const apiscopeFastify = fastifyPlugin(plugin, { name: '@apiscope/fastify', fastify: '>=5.0.0' })
