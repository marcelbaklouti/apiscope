import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { AdvisorConfigInput } from '@apiscope/advisor'
import type { DashboardAuthenticator } from './auth/dashboard-auth'
import type { IngestAuthenticator } from './auth/ingest-auth'
import type { LiveTransport } from './live/live-transport'
import type { OtlpExportConfig } from './otlp/exporter'
import type { Sampler } from './sampling/sampler'
import type { SpanStore } from './store-interface'

export interface TlsOptions {
  key: string
  cert: string
  ca?: string
  requestCert?: boolean
}

export interface OtlpIngestOptions {
  http?: boolean
  grpc?: boolean
  grpcPort?: number
  appName?: string
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
  otlpExport?: OtlpExportConfig
  otlpIngest?: OtlpIngestOptions
  advisor?: AdvisorConfigInput
  loadAllowRemoteHosts?: string[]
  allowedOrigins?: string[]
  maxRequestBytes?: number
}

export type RouteHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => void | Promise<void>

export type DynamicHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => boolean | Promise<boolean>

export const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024 * 1024

export class PayloadTooLargeError extends Error {}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(payload)
}

export async function readRawBody(request: IncomingMessage, maxBytes: number = DEFAULT_MAX_REQUEST_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    totalBytes += buffer.length
    if (totalBytes > maxBytes) {
      request.pause()
      throw new PayloadTooLargeError(`request body exceeds ${maxBytes} bytes`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export async function readBody(request: IncomingMessage, maxBytes: number = DEFAULT_MAX_REQUEST_BYTES): Promise<string> {
  return (await readRawBody(request, maxBytes)).toString('utf8')
}

function respondToHandlerError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) return
  if (error instanceof PayloadTooLargeError) {
    const payload = JSON.stringify({ error: 'payload-too-large' })
    response.writeHead(413, { 'content-type': 'application/json', connection: 'close' })
    response.end(payload)
    return
  }
  sendJson(response, 500, { error: 'internal' })
}

export function createRequestListener(routes: Map<string, RouteHandler>, dynamicHandlers: DynamicHandler[] = []): RequestListener {
  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const handler = routes.get(`${request.method} ${url.pathname}`)
    if (handler) {
      try {
        await handler(request, response, url)
      } catch (error) {
        respondToHandlerError(response, error)
      }
      return
    }
    try {
      for (const dynamicHandler of dynamicHandlers) {
        if (await dynamicHandler(request, response, url)) return
      }
    } catch (error) {
      respondToHandlerError(response, error)
      return
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
