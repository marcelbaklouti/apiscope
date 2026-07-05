import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { catchError } from 'rxjs/operators'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { newSpanId, type SpanError } from '@apiscope/core'
import { AdapterRuntime } from '@apiscope/adapter-node'
import { joinRoutePaths } from './registry'

export const APISCOPE_RUNTIME = Symbol('APISCOPE_RUNTIME')

interface PendingSpan {
  spanId: string
  traceId: string
  parentSpanId?: string
  loadRunId?: string
  startedAtWall: number
  startedAtHighRes: number
  routePattern: string | null
  error?: SpanError
}

function flattenHeaders(headers: Record<string, string | string[] | number | undefined>): Record<string, string> {
  const flattened: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    flattened[name] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return flattened
}

@Injectable()
export class ApiscopeInterceptor implements NestInterceptor {
  private readonly instrumentedResponses = new WeakSet<ServerResponse>()

  constructor(@Inject(APISCOPE_RUNTIME) private readonly runtime: AdapterRuntime) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle()
    try {
      const http = context.switchToHttp()
      const request = http.getRequest<IncomingMessage & { body?: unknown; originalUrl?: string }>()
      const response = http.getResponse<ServerResponse>()
      const controllerPath = Reflect.getMetadata('path', context.getClass()) as string | undefined
      const handlerPath = Reflect.getMetadata('path', context.getHandler()) as string | undefined
      const spanContext = this.runtime.openSpanContext(request.headers)
      const ids = { traceId: spanContext.traceId, spanId: newSpanId() }
      this.runtime.enterSpan(ids)
      const pending: PendingSpan = {
        spanId: ids.spanId,
        traceId: ids.traceId,
        startedAtWall: Date.now(),
        startedAtHighRes: performance.now(),
        routePattern: joinRoutePaths(controllerPath, handlerPath),
        ...(spanContext.parentSpanId === undefined ? {} : { parentSpanId: spanContext.parentSpanId }),
        ...(spanContext.loadRunId === undefined ? {} : { loadRunId: spanContext.loadRunId })
      }
      if (!this.instrumentedResponses.has(response)) {
        this.instrumentedResponses.add(response)
        response.once('finish', () => {
          try {
            const rawUrl = request.originalUrl ?? request.url ?? '/'
            const requestPayload = this.runtime.capturePayload(
              flattenHeaders(request.headers),
              request.body === undefined ? undefined : JSON.stringify(request.body)
            )
            const responsePayload = this.runtime.capturePayload(
              flattenHeaders(response.getHeaders() as Record<string, string | string[] | number | undefined>),
              undefined
            )
            this.runtime.recordSpan({
              id: pending.spanId,
              traceId: pending.traceId,
              method: request.method ?? 'GET',
              routePattern: pending.routePattern,
              actualPath: rawUrl.split('?')[0] ?? rawUrl,
              statusCode: response.statusCode,
              timing: {
                start: pending.startedAtWall,
                ttfb: null,
                duration: performance.now() - pending.startedAtHighRes
              },
              framework: 'nestjs',
              runtime: 'node',
              ...(pending.parentSpanId === undefined ? {} : { parentSpanId: pending.parentSpanId }),
              ...(pending.loadRunId === undefined ? {} : { loadRunId: pending.loadRunId }),
              ...(pending.error === undefined ? {} : { error: pending.error }),
              ...(requestPayload === undefined ? {} : { request: requestPayload }),
              ...(responsePayload === undefined ? {} : { response: responsePayload })
            })
          } catch {}
        })
      }
      return next.handle().pipe(
        catchError((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          const stack = error instanceof Error ? error.stack : undefined
          pending.error = { message, ...(stack === undefined ? {} : { stack }) }
          throw error
        })
      )
    } catch {
      return next.handle()
    }
  }
}
