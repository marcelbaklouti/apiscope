import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createDashboardAuthenticator, type DashboardAuthenticator } from './auth/dashboard-auth'
import { createNoneIngestAuthenticator, type IngestAuthenticator } from './auth/ingest-auth'
import { IngestProcessor } from './ingest'
import { InProcessLiveTransport } from './live-hub'
import type { LiveTransport } from './live/live-transport'
import { startLoadRun, type LoadRunRequest } from './load-runs'
import { createKeepAllSampler } from './sampling/sampler'
import { createStaticHandler } from './static'
import { SqliteSpanStore } from './store'
import type { SpanStore } from './store-interface'
import { attachWebSockets } from './websocket'
import { createHttpServer, readBody, sendJson, type CollectorOptions, type DynamicHandler, type RouteHandler } from './server'

export type { CollectorOptions }
export type { SpanStore, RouteStats, StoredLoadRun, StoredLoadRunSummary } from './store-interface'
export { SqliteSpanStore } from './store'
export { InProcessLiveTransport, LiveHub } from './live-hub'
export type { LiveEvent } from './live-events'
export type { LiveTransport } from './live/live-transport'
export { createValkeyLiveTransport } from './live/valkey-transport'
export { IngestProcessor } from './ingest'
export { attachWebSockets } from './websocket'
export { resolveStore } from './store-factory'
export type { StorageConfig } from './store-factory'
export { createNoneIngestAuthenticator, createTokenIngestAuthenticator } from './auth/ingest-auth'
export type { IngestAuthenticator, IngestIdentity, TokenEntry } from './auth/ingest-auth'
export { createDashboardAuthenticator } from './auth/dashboard-auth'
export type { DashboardAuthenticator, DashboardIdentity, DashboardAuthConfig } from './auth/dashboard-auth'
export { createKeepAllSampler, createTailSampler } from './sampling/sampler'
export type { Sampler, TailSamplerOptions } from './sampling/sampler'

export interface Collector {
  listen(): Promise<{ host: string; port: number }>
  close(): Promise<void>
  store: SpanStore
  hub: LiveTransport
}

function handleIngest(processor: IngestProcessor, ingestAuth: IngestAuthenticator) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const identity = ingestAuth.authenticate(request)
    if (identity === null) {
      sendJson(response, 401, { error: 'unauthorized' })
      return
    }
    const raw = await readBody(request)
    const headerApp = request.headers['x-apiscope-app']
    const session = {
      appName: typeof headerApp === 'string' ? headerApp : null,
      authenticatedApp: identity.appName === '' ? null : identity.appName
    }
    const result = await processor.process(raw, session)
    if (result.ok) sendJson(response, 202, { accepted: true })
    else sendJson(response, 400, { error: result.error })
  }
}

function createInlineNoneDashboardAuthenticator(): DashboardAuthenticator {
  return {
    async authenticate() {
      return { subject: 'anonymous', displayName: 'anonymous' }
    },
    routes: new Map(),
    requiresLoginRedirect: false,
    mode: 'none'
  }
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

const guardExemptRoutes = new Set(['GET /health', 'POST /ingest', 'GET /api/session'])

function isGuardExemptRoute(route: string, dashboardAuth: DashboardAuthenticator): boolean {
  if (guardExemptRoutes.has(route)) return true
  return dashboardAuth.routes.has(route)
}

function requiresDashboardIdentity(pathname: string): boolean {
  return pathname.startsWith('/api/') || !pathname.startsWith('/auth/')
}

async function respondUnauthenticated(response: ServerResponse, pathname: string, dashboardAuth: DashboardAuthenticator): Promise<void> {
  if (pathname.startsWith('/api/')) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }
  if (dashboardAuth.requiresLoginRedirect) {
    response.writeHead(302, { location: '/auth/login' })
    response.end()
    return
  }
  sendJson(response, 401, { error: 'unauthorized' })
}

function wrapWithDashboardGuard(route: string, handler: RouteHandler, dashboardAuth: DashboardAuthenticator): RouteHandler {
  if (isGuardExemptRoute(route, dashboardAuth)) return handler
  return async (request, response, url) => {
    const identity = await dashboardAuth.authenticate(request)
    if (identity === null) {
      await respondUnauthenticated(response, url.pathname, dashboardAuth)
      return
    }
    await handler(request, response, url)
  }
}

function wrapDynamicWithDashboardGuard(handler: DynamicHandler, dashboardAuth: DashboardAuthenticator): DynamicHandler {
  return async (request, response, url) => {
    if (!requiresDashboardIdentity(url.pathname)) return handler(request, response, url)
    const identity = await dashboardAuth.authenticate(request)
    if (identity === null) {
      await respondUnauthenticated(response, url.pathname, dashboardAuth)
      return true
    }
    return handler(request, response, url)
  }
}

export function createCollector(options: CollectorOptions): Collector {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 4620
  const storeOptions = options.retentionRows === undefined ? {} : { retentionRows: options.retentionRows }
  const store = options.store ?? new SqliteSpanStore(options.dbPath, storeOptions)
  const hub = options.hub ?? new InProcessLiveTransport()
  const sampler = options.sampler ?? createKeepAllSampler()
  const processor = new IngestProcessor(store, hub, sampler)
  const ingestAuth = options.ingestAuth ?? createNoneIngestAuthenticator()
  const dashboardAuth = options.dashboardAuth ?? createInlineNoneDashboardAuthenticator()
  if (dashboardAuth.mode === 'none' && !isLoopbackHost(host) && options.allowInsecure !== true) {
    throw new Error('refusing to start: dashboard auth is "none" on a non-loopback host; set allowInsecure to override (insecure)')
  }
  const routes = new Map<string, RouteHandler>()
  routes.set('GET /health', (request, response) => sendJson(response, 200, { status: 'ok' }))
  routes.set('GET /api/session', async (request, response) => {
    const identity = await dashboardAuth.authenticate(request)
    sendJson(response, 200, identity === null ? { authenticated: false } : { authenticated: true, identity })
  })
  for (const [route, handler] of dashboardAuth.routes) {
    routes.set(route, handler)
  }
  routes.set('POST /ingest', handleIngest(processor, ingestAuth))
  routes.set('GET /api/spans', async (request, response, url) => {
    const requested = Number(url.searchParams.get('limit') ?? '100')
    const limit = Number.isFinite(requested) ? Math.min(Math.max(1, requested), 1000) : 100
    sendJson(response, 200, await store.recentSpans(limit))
  })
  routes.set('GET /api/routes', async (request, response) => sendJson(response, 200, await store.listRoutes()))
  routes.set('GET /api/route-stats', async (request, response) => sendJson(response, 200, await store.routeStats()))
  routes.set('GET /api/meta', (request, response) => sendJson(response, 200, { meta: options.meta ?? null }))
  routes.set('GET /api/load-runs', async (request, response) => sendJson(response, 200, await store.listLoadRuns()))
  routes.set('POST /api/load-runs', async (request, response) => {
    const raw = await readBody(request)
    try {
      const parsed = JSON.parse(raw) as LoadRunRequest
      const { runId } = startLoadRun(parsed, store, hub)
      sendJson(response, 202, { runId })
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'invalid request' })
    }
  })
  const spanDetailHandler: DynamicHandler = async (request, response, url) => {
    const match = url.pathname.match(/^\/api\/spans\/([^/]+)$/)
    if (request.method !== 'GET' || match === null || match[1] === undefined) return false
    const detail = await store.spanById(decodeURIComponent(match[1]))
    if (detail === null) sendJson(response, 404, { error: 'not-found' })
    else sendJson(response, 200, detail)
    return true
  }
  const loadRunDetailHandler: DynamicHandler = async (request, response, url) => {
    const match = url.pathname.match(/^\/api\/load-runs\/([^/]+)$/)
    if (request.method !== 'GET' || match === null || match[1] === undefined) return false
    const stored = await store.loadRunById(decodeURIComponent(match[1]))
    if (stored === null) {
      sendJson(response, 404, { error: 'not-found' })
      return true
    }
    const { scenario, assertions } = JSON.parse(stored.scenarioJson) as {
      scenario: unknown
      assertions: unknown
    }
    const result = JSON.parse(stored.resultJson) as unknown
    sendJson(response, 200, {
      id: stored.id,
      name: stored.name,
      startedAt: stored.startedAt,
      scenario,
      assertions,
      result
    })
    return true
  }
  const dynamicHandlers: DynamicHandler[] = [
    spanDetailHandler,
    loadRunDetailHandler,
    ...(options.dashboardDir === undefined ? [] : [createStaticHandler(options.dashboardDir)])
  ]
  const guardedRoutes = new Map<string, RouteHandler>()
  for (const [route, handler] of routes) {
    guardedRoutes.set(route, wrapWithDashboardGuard(route, handler, dashboardAuth))
  }
  const guardedDynamicHandlers = dynamicHandlers.map((handler) => wrapDynamicWithDashboardGuard(handler, dashboardAuth))
  const server: Server = createHttpServer(guardedRoutes, guardedDynamicHandlers, options.tls)
  attachWebSockets(server, processor, hub, ingestAuth)
  return {
    store,
    hub,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          const address = server.address()
          if (address === null || typeof address === 'string') {
            reject(new Error('collector failed to bind'))
            return
          }
          resolve({ host, port: address.port })
        })
      })
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          void store.close().then(() => {
            if (error) reject(error)
            else resolve()
          })
        })
      })
    }
  }
}
