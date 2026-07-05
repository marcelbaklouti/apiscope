import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { DashboardAuthenticator } from './auth/dashboard-auth'
import type { IngestAuthenticator } from './auth/ingest-auth'
import type { LiveTransport } from './live/live-transport'
import type { Sampler } from './sampling/sampler'
import type { SpanStore } from './store-interface'

export interface TlsOptions {
  key: string
  cert: string
  ca?: string
  requestCert?: boolean
}

export interface CollectorOptions {
  dbPath: string
  host?: string
  port?: number
  retentionRows?: number
  dashboardDir?: string
  meta?: unknown
  store?: SpanStore
  ingestAuth?: IngestAuthenticator
  dashboardAuth?: DashboardAuthenticator
  sampler?: Sampler
  hub?: LiveTransport
  tls?: TlsOptions
  allowInsecure?: boolean
}

export type RouteHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => void | Promise<void>

export type DynamicHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => boolean | Promise<boolean>

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(payload)
}

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export function createRequestListener(routes: Map<string, RouteHandler>, dynamicHandlers: DynamicHandler[] = []): RequestListener {
  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const handler = routes.get(`${request.method} ${url.pathname}`)
    if (handler) {
      try {
        await handler(request, response, url)
      } catch {
        if (!response.headersSent) sendJson(response, 500, { error: 'internal' })
      }
      return
    }
    for (const dynamicHandler of dynamicHandlers) {
      if (await dynamicHandler(request, response, url)) return
    }
    sendJson(response, 404, { error: 'not-found' })
  }
}

export function createHttpServer(
  routes: Map<string, RouteHandler>,
  dynamicHandlers: DynamicHandler[] = [],
  tls?: TlsOptions
): Server {
  const requestListener = createRequestListener(routes, dynamicHandlers)
  if (tls === undefined) return createServer(requestListener)
  return createHttpsServer(
    {
      key: tls.key,
      cert: tls.cert,
      ...(tls.ca === undefined ? {} : { ca: tls.ca }),
      requestCert: tls.requestCert ?? false,
      rejectUnauthorized: tls.requestCert ?? false
    },
    requestListener
  )
}
