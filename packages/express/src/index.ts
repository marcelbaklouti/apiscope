import type { Express, NextFunction, Request, RequestHandler, Response } from 'express'
import { AdapterRuntime, subscribeUndici, type AdapterRuntimeOptions } from '@apiscope/adapter-node'
import { BODY_CAPTURE_LIMIT_BYTES, newSpanId } from '@apiscope/core'
import { extractExpressRoutes } from './routes'

export { extractExpressRoutes } from './routes'

export type ExpressAdapterOptions = Omit<AdapterRuntimeOptions, 'framework' | 'transport'> & {
  runtime?: AdapterRuntime
}

function flattenHeaders(headers: Record<string, string | string[] | number | undefined>): Record<string, string> {
  const flattened: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    flattened[name] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return flattened
}

function createBoundedChunkBuffer(limitBytes: number): { push(chunk: Buffer): void; toStringOrUndefined(): string | undefined } {
  const chunks: Buffer[] = []
  let bufferedBytes = 0
  return {
    push(chunk) {
      if (bufferedBytes > limitBytes) return
      chunks.push(chunk)
      bufferedBytes += chunk.byteLength
    },
    toStringOrUndefined() {
      return chunks.length === 0 ? undefined : Buffer.concat(chunks).toString('utf8')
    }
  }
}

export function apiscopeExpress(options: ExpressAdapterOptions): RequestHandler {
  const runtime =
    options.runtime ??
    new AdapterRuntime({
      appName: options.appName,
      framework: 'express',
      ...(options.collectorUrl === undefined ? {} : { collectorUrl: options.collectorUrl }),
      ...(options.capture === undefined ? {} : { capture: options.capture }),
      ...(options.additionalRedactedHeaders === undefined
        ? {}
        : { additionalRedactedHeaders: options.additionalRedactedHeaders })
    })
  runtime.start()
  subscribeUndici(runtime)
  let registryPushed = false

  return (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!registryPushed) {
        registryPushed = true
        runtime.setRoutes(extractExpressRoutes(request.app as Express))
      }
      const spanContext = runtime.openSpanContext(request.headers)
      const context = { traceId: spanContext.traceId, spanId: newSpanId() }
      const startedAtWall = Date.now()
      const startedAt = performance.now()
      let ttfb: number | null = null
      const originalWriteHead = response.writeHead.bind(response)
      response.writeHead = ((...writeHeadArguments: Parameters<Response['writeHead']>) => {
        if (ttfb === null) ttfb = performance.now() - startedAt
        return originalWriteHead(...writeHeadArguments)
      }) as Response['writeHead']
      const capturesBodies = runtime.capturesBodies
      const responseBuffer = capturesBodies ? createBoundedChunkBuffer(BODY_CAPTURE_LIMIT_BYTES) : null
      if (responseBuffer !== null) {
        const originalWrite = response.write.bind(response)
        response.write = ((chunk: unknown, ...rest: unknown[]) => {
          if (chunk !== undefined && chunk !== null) responseBuffer.push(Buffer.from(chunk as Buffer | string))
          return (originalWrite as (...writeArguments: unknown[]) => boolean)(chunk, ...rest)
        }) as Response['write']
        const originalEnd = response.end.bind(response)
        response.end = ((chunk?: unknown, ...rest: unknown[]) => {
          if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
            responseBuffer.push(Buffer.from(chunk as Buffer | string))
          }
          return (originalEnd as (...endArguments: unknown[]) => Response)(chunk, ...rest)
        }) as Response['end']
      }
      response.on('finish', () => {
        try {
          const routePath = (request as Request & { route?: { path: string } }).route?.path
          const routePattern = routePath === undefined ? null : `${request.baseUrl}${routePath}`.replace(/\/{2,}/g, '/')
          const requestPayload = runtime.capturePayload(
            flattenHeaders(request.headers),
            !capturesBodies || request.body === undefined ? undefined : JSON.stringify(request.body)
          )
          const responsePayload = runtime.capturePayload(
            flattenHeaders(response.getHeaders() as Record<string, string | string[] | number | undefined>),
            responseBuffer?.toStringOrUndefined()
          )
          runtime.recordSpan({
            id: context.spanId,
            traceId: context.traceId,
            method: request.method,
            routePattern,
            actualPath: request.originalUrl.split('?')[0] ?? request.originalUrl,
            statusCode: response.statusCode,
            timing: { start: startedAtWall, ttfb, duration: performance.now() - startedAt },
            framework: 'express',
            runtime: 'node',
            ...(spanContext.parentSpanId === undefined ? {} : { parentSpanId: spanContext.parentSpanId }),
            ...(spanContext.loadRunId === undefined ? {} : { loadRunId: spanContext.loadRunId }),
            ...(requestPayload === undefined ? {} : { request: requestPayload }),
            ...(responsePayload === undefined ? {} : { response: responsePayload })
          })
        } catch {}
      })
      runtime.runWithSpan(context, () => next())
    } catch {
      next()
    }
  }
}
