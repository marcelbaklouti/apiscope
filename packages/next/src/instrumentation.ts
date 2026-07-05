import { AdapterRuntime, subscribeUndici } from '@apiscope/adapter-node'
import { matchRoutePattern, scanNextRoutes } from './scanner'
import { subscribeHttpServer } from './server-spans'
import { watchRoutes } from './watcher'

export interface NextAdapterOptions {
  appName: string
  collectorUrl?: string
  capture?: 'none' | 'headers' | 'full'
  additionalRedactedHeaders?: string[]
  projectDir?: string
  runtime?: AdapterRuntime
}

export interface NextRequestErrorInfo {
  path: string
  method: string
}

export function withApiscope(options: NextAdapterOptions) {
  const projectDir = options.projectDir ?? process.cwd()
  let runtime: AdapterRuntime | null = options.runtime ?? null
  let patterns: string[] = []

  const ensureRuntime = (): AdapterRuntime => {
    if (runtime === null) {
      runtime = new AdapterRuntime({
        appName: options.appName,
        framework: 'next',
        ...(options.collectorUrl === undefined ? {} : { collectorUrl: options.collectorUrl }),
        ...(options.capture === undefined ? {} : { capture: options.capture }),
        ...(options.additionalRedactedHeaders === undefined
          ? {}
          : { additionalRedactedHeaders: options.additionalRedactedHeaders })
      })
    }
    return runtime
  }

  const refreshRoutes = () => {
    try {
      const routes = scanNextRoutes(projectDir)
      patterns = routes.map((route) => route.pattern)
      ensureRuntime().setRoutes(routes)
    } catch {}
  }

  return {
    async register(): Promise<void> {
      if (process.env.NEXT_RUNTIME !== 'nodejs') return
      try {
        const activeRuntime = ensureRuntime()
        activeRuntime.start()
        refreshRoutes()
        subscribeHttpServer(activeRuntime, () => patterns)
        subscribeUndici(activeRuntime)
        watchRoutes(projectDir, refreshRoutes)
      } catch {}
    },
    async onRequestError(error: unknown, request: NextRequestErrorInfo, context: unknown): Promise<void> {
      void context
      if (process.env.NEXT_RUNTIME !== 'nodejs') return
      try {
        const activeRuntime = ensureRuntime()
        const message = error instanceof Error ? error.message : String(error)
        const digest =
          typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest: unknown }).digest) : undefined
        const stack = error instanceof Error ? error.stack : undefined
        const ids = activeRuntime.newIds()
        const path = request.path.split('?')[0] ?? request.path
        activeRuntime.recordSpan({
          id: ids.spanId,
          traceId: ids.traceId,
          method: request.method,
          routePattern: matchRoutePattern(patterns, path),
          actualPath: path,
          statusCode: 500,
          timing: { start: Date.now(), ttfb: null, duration: 0 },
          framework: 'next',
          runtime: 'node',
          error: {
            message,
            ...(digest === undefined ? {} : { digest }),
            ...(stack === undefined ? {} : { stack })
          }
        })
      } catch {}
    }
  }
}
