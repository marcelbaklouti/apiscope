import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { generateScenario } from '@apiscope/load'
import { buildDependencyGraph, type SpanWithChildren } from './analysis/dependencies'
import { detectNPlusOne } from './analysis/nplusone'
import { createDashboardAuthenticator, type DashboardAuthenticator } from './auth/dashboard-auth'
import { createNoneIngestAuthenticator, type IngestAuthenticator } from './auth/ingest-auth'
import { IngestProcessor } from './ingest'
import { InProcessLiveTransport } from './live-hub'
import type { LiveTransport } from './live/live-transport'
import { startLoadRun, type LoadRunRequest } from './load-runs'
import { createMetrics } from './metrics'
import { createOtlpExporter } from './otlp/exporter'
import { createOtlpGrpcServer } from './otlp/receiver-grpc'
import { createOtlpHttpHandler } from './otlp/receiver-http'
import { ProfileChannelRegistry, type ProfileResult } from './profiles/registry'
import { ProfileResultStore } from './profiles/store'
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
export { createMetrics } from './metrics'
export type { CollectorMetrics } from './metrics'
export type { ProfileResult } from './profiles/registry'
export type { StoredProfile } from './profiles/store'

export interface Collector {
  listen(): Promise<{ host: string; port: number }>
  close(): Promise<void>
  store: SpanStore
  hub: LiveTransport
  otlpGrpcPort?: number
  connectedApp(appName: string): string | null
  requestProfile(appName: string, durationMs: number): Promise<ProfileResult>
}

const N_PLUS_ONE_RECENT_SPAN_WINDOW = 200
const DEPENDENCY_GRAPH_RECENT_SPAN_WINDOW = 200
const SCENARIO_RECENT_SPAN_LIMIT = 1000
const SCENARIO_DEFAULT_WINDOW_MS = 5 * 60 * 1000

async function loadRecentSpansWithChildren(store: SpanStore, limit: number): Promise<SpanWithChildren[]> {
  const recentSpans = await store.recentSpans(limit)
  const spansWithChildren: SpanWithChildren[] = []
  for (const span of recentSpans) {
    const detail = await store.spanById(span.id)
    if (detail === null) continue
    spansWithChildren.push({ span: detail.span, childSpans: detail.childSpans })
  }
  return spansWithChildren
}

async function countNPlusOneRequestsByRoute(store: SpanStore): Promise<Map<string, number>> {
  const recentSpans = await store.recentSpans(N_PLUS_ONE_RECENT_SPAN_WINDOW)
  const counts = new Map<string, number>()
  for (const span of recentSpans) {
    if (span.routePattern === null) continue
    const detail = await store.spanById(span.id)
    if (detail === null) continue
    const groups = detectNPlusOne(detail.childSpans)
    if (groups.length === 0) continue
    const key = `${span.method} ${span.routePattern}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
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

const guardExemptRoutes = new Set(['GET /health', 'GET /metrics', 'POST /ingest', 'GET /api/session'])

function isGuardExemptRoute(route: string, dashboardAuth: DashboardAuthenticator): boolean {
  if (guardExemptRoutes.has(route)) return true
  return dashboardAuth.routes.has(route)
}

function requiresDashboardIdentity(pathname: string): boolean {
  if (pathname === '/v1/traces') return false
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
  const metrics = createMetrics()
  const exporter = options.otlpExport === undefined ? undefined : createOtlpExporter(options.otlpExport)
  const processor = new IngestProcessor(store, hub, sampler, metrics, exporter)
  const profileChannel = new ProfileChannelRegistry()
  const profileResults = new ProfileResultStore()
  const ingestAuth = options.ingestAuth ?? createNoneIngestAuthenticator()
  const dashboardAuth = options.dashboardAuth ?? createInlineNoneDashboardAuthenticator()
  if (dashboardAuth.mode === 'none' && !isLoopbackHost(host) && options.allowInsecure !== true) {
    throw new Error('refusing to start: dashboard auth is "none" on a non-loopback host; set allowInsecure to override (insecure)')
  }
  const routes = new Map<string, RouteHandler>()
  routes.set('GET /health', (request, response) => sendJson(response, 200, { status: 'ok' }))
  routes.set('GET /metrics', async (request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
    response.end(await metrics.render())
  })
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
    const loadRunId = url.searchParams.get('loadRunId')
    sendJson(response, 200, loadRunId === null ? await store.recentSpans(limit) : await store.spansByLoadRun(loadRunId, limit))
  })
  routes.set('GET /api/routes', async (request, response) => {
    const registryEntries = await store.listRoutes()
    const nPlusOneRequestsByRoute = await countNPlusOneRequestsByRoute(store)
    const withIndicator = registryEntries.map((entry) => ({
      ...entry,
      nPlusOneRequests: nPlusOneRequestsByRoute.get(`${entry.method} ${entry.pattern}`) ?? 0
    }))
    sendJson(response, 200, withIndicator)
  })
  routes.set('GET /api/route-stats', async (request, response) => sendJson(response, 200, await store.routeStats()))
  routes.set('GET /api/scenario', async (request, response, url) => {
    const requestedWindowMs = Number(url.searchParams.get('windowMs') ?? String(SCENARIO_DEFAULT_WINDOW_MS))
    const windowMs = Number.isFinite(requestedWindowMs) && requestedWindowMs > 0 ? requestedWindowMs : SCENARIO_DEFAULT_WINDOW_MS
    const baseUrl = url.searchParams.get('baseUrl') ?? 'http://127.0.0.1:3000'
    const shapeParam = url.searchParams.get('shape')
    const shape = shapeParam === 'ramp' ? 'ramp' : 'steady'
    const cutoff = Date.now() - windowMs
    const recentSpans = await store.recentSpans(SCENARIO_RECENT_SPAN_LIMIT)
    const spansInWindow = recentSpans.filter((span) => span.timing.start >= cutoff)
    sendJson(response, 200, generateScenario({ spans: spansInWindow, baseUrl, shape }))
  })
  routes.set('GET /api/dependencies', async (request, response) => {
    const spansWithChildren = await loadRecentSpansWithChildren(store, DEPENDENCY_GRAPH_RECENT_SPAN_WINDOW)
    sendJson(response, 200, buildDependencyGraph(spansWithChildren))
  })
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
  routes.set('POST /api/profiles', async (request, response) => {
    const raw = await readBody(request)
    try {
      const { appName, durationMs } = JSON.parse(raw) as { appName?: string; durationMs?: number }
      if (typeof appName !== 'string' || appName === '') throw new Error('appName is required')
      if (typeof durationMs !== 'number' || durationMs <= 0) throw new Error('durationMs must be a positive number')
      const result = await profileChannel.requestProfile(appName, durationMs)
      if (!result.ok || result.flamegraph === undefined || result.pprofBase64 === undefined) {
        sendJson(response, 502, { error: result.error ?? 'profile capture failed' })
        return
      }
      const profileId = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      profileResults.put({
        id: profileId,
        appName,
        capturedAt: Date.now(),
        flamegraph: result.flamegraph,
        pprofBase64: result.pprofBase64
      })
      sendJson(response, 202, { profileId })
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'invalid request' })
    }
  })
  const spanDetailHandler: DynamicHandler = async (request, response, url) => {
    const match = url.pathname.match(/^\/api\/spans\/([^/]+)$/)
    if (request.method !== 'GET' || match === null || match[1] === undefined) return false
    const detail = await store.spanById(decodeURIComponent(match[1]))
    if (detail === null) sendJson(response, 404, { error: 'not-found' })
    else sendJson(response, 200, { ...detail, nPlusOne: detectNPlusOne(detail.childSpans) })
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
  const profileDetailHandler: DynamicHandler = (request, response, url) => {
    const match = url.pathname.match(/^\/api\/profiles\/([^/]+)$/)
    if (request.method !== 'GET' || match === null || match[1] === undefined) return false
    const stored = profileResults.get(decodeURIComponent(match[1]))
    if (stored === null) sendJson(response, 404, { error: 'not-found' })
    else sendJson(response, 200, { id: stored.id, appName: stored.appName, capturedAt: stored.capturedAt, flamegraph: stored.flamegraph })
    return true
  }
  const profilePprofHandler: DynamicHandler = (request, response, url) => {
    const match = url.pathname.match(/^\/api\/profiles\/([^/]+)\/pprof$/)
    if (request.method !== 'GET' || match === null || match[1] === undefined) return false
    const stored = profileResults.get(decodeURIComponent(match[1]))
    if (stored === null) {
      sendJson(response, 404, { error: 'not-found' })
      return true
    }
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${stored.id}.pprof"`
    })
    response.end(Buffer.from(stored.pprofBase64, 'base64'))
    return true
  }
  const otlpHttpHandler: DynamicHandler | null =
    options.otlpIngest?.http === true
      ? createOtlpHttpHandler({
          appName: options.otlpIngest.appName ?? 'otlp',
          ingestAuth,
          ingest: (appName, spans, childSpans) => processor.ingestSpans(appName, spans, childSpans)
        })
      : null
  const dynamicHandlers: DynamicHandler[] = [
    spanDetailHandler,
    loadRunDetailHandler,
    profilePprofHandler,
    profileDetailHandler,
    ...(otlpHttpHandler === null ? [] : [otlpHttpHandler]),
    ...(options.dashboardDir === undefined ? [] : [createStaticHandler(options.dashboardDir)])
  ]
  const guardedRoutes = new Map<string, RouteHandler>()
  for (const [route, handler] of routes) {
    guardedRoutes.set(route, wrapWithDashboardGuard(route, handler, dashboardAuth))
  }
  const guardedDynamicHandlers = dynamicHandlers.map((handler) => wrapDynamicWithDashboardGuard(handler, dashboardAuth))
  const server: Server = createHttpServer(guardedRoutes, guardedDynamicHandlers, options.tls)
  attachWebSockets(server, processor, hub, ingestAuth, metrics, profileChannel, dashboardAuth)
  const otlpGrpcServer =
    options.otlpIngest?.grpc === true
      ? createOtlpGrpcServer({
          host,
          port: options.otlpIngest.grpcPort ?? 4317,
          appName: options.otlpIngest.appName ?? 'otlp',
          ingest: (appName, spans, childSpans) => processor.ingestSpans(appName, spans, childSpans)
        })
      : null
  const collector: Collector = {
    store,
    hub,
    connectedApp(appName: string) {
      return profileChannel.isConnected(appName) ? appName : null
    },
    requestProfile(appName: string, durationMs: number) {
      return profileChannel.requestProfile(appName, durationMs)
    },
    async listen() {
      const address = await new Promise<{ host: string; port: number }>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          const boundAddress = server.address()
          if (boundAddress === null || typeof boundAddress === 'string') {
            reject(new Error('collector failed to bind'))
            return
          }
          resolve({ host, port: boundAddress.port })
        })
      })
      if (otlpGrpcServer !== null) {
        collector.otlpGrpcPort = await otlpGrpcServer.start()
      }
      return address
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          void Promise.resolve(otlpGrpcServer === null ? undefined : otlpGrpcServer.stop())
            .then(() => store.close())
            .then(() => {
              if (error) reject(error)
              else resolve()
            })
        })
      })
    }
  }
  return collector
}
