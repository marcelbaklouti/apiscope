import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface CollectorOptions {
  dbPath: string
  host?: string
  port?: number
  retentionRows?: number
  dashboardDir?: string
  meta?: unknown
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

export function createHttpServer(routes: Map<string, RouteHandler>, dynamicHandlers: DynamicHandler[] = []): Server {
  return createServer(async (request, response) => {
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
  })
}
