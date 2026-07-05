import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { IngestProcessor } from './ingest'
import { LiveHub } from './live-hub'
import { SpanStore } from './store'
import { attachWebSockets } from './websocket'
import { createHttpServer, readBody, sendJson, type CollectorOptions, type RouteHandler } from './server'

export type { CollectorOptions }
export { SpanStore } from './store'
export type { RouteStats } from './store'
export { LiveHub } from './live-hub'
export type { LiveEvent } from './live-hub'
export { IngestProcessor } from './ingest'
export { attachWebSockets } from './websocket'

export interface Collector {
  listen(): Promise<{ host: string; port: number }>
  close(): Promise<void>
  store: SpanStore
  hub: LiveHub
}

function handleIngest(processor: IngestProcessor) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const raw = await readBody(request)
    const headerApp = request.headers['x-apiscope-app']
    const session = { appName: typeof headerApp === 'string' ? headerApp : null }
    const result = processor.process(raw, session)
    if (result.ok) sendJson(response, 202, { accepted: true })
    else sendJson(response, 400, { error: result.error })
  }
}

export function createCollector(options: CollectorOptions): Collector {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 4620
  const storeOptions = options.retentionRows === undefined ? {} : { retentionRows: options.retentionRows }
  const store = new SpanStore(options.dbPath, storeOptions)
  const hub = new LiveHub()
  const processor = new IngestProcessor(store, hub)
  const routes = new Map<string, RouteHandler>()
  routes.set('GET /health', (request, response) => sendJson(response, 200, { status: 'ok' }))
  routes.set('POST /ingest', handleIngest(processor))
  routes.set('GET /api/spans', (request, response, url) => {
    const requested = Number(url.searchParams.get('limit') ?? '100')
    const limit = Number.isFinite(requested) ? Math.min(Math.max(1, requested), 1000) : 100
    sendJson(response, 200, store.recentSpans(limit))
  })
  routes.set('GET /api/routes', (request, response) => sendJson(response, 200, store.listRoutes()))
  routes.set('GET /api/route-stats', (request, response) => sendJson(response, 200, store.routeStats()))
  const server: Server = createHttpServer(routes, (request, response, url) => {
    const match = url.pathname.match(/^\/api\/spans\/([^/]+)$/)
    if (request.method !== 'GET' || match === null || match[1] === undefined) return false
    const detail = store.spanById(decodeURIComponent(match[1]))
    if (detail === null) sendJson(response, 404, { error: 'not-found' })
    else sendJson(response, 200, detail)
    return true
  })
  attachWebSockets(server, processor, hub)
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
          store.close()
          if (error) reject(error)
          else resolve()
        })
      })
    }
  }
}
