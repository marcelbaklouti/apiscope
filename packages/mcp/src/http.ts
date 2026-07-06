import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CollectorClient } from './client'
import { createMcpServer } from './server'

export interface HttpServerOptions {
  port: number
  host?: string
  allowedOrigins?: string[]
  authToken?: string
}

export interface HttpServerHandle {
  port: number
  close(): Promise<void>
}

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function originHostPort(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

function isAllowedOrigin(request: IncomingMessage, allowedOrigins: string[]): boolean {
  const origin = headerValue(request, 'origin')
  if (origin === null) return true
  const originHost = originHostPort(origin)
  if (originHost === null) return false
  const host = headerValue(request, 'host')
  if (host !== null && originHost === host) return true
  return allowedOrigins.some((allowed) => allowed === origin || originHostPort(allowed) === originHost)
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

function hasValidBearer(request: IncomingMessage, authToken: string): boolean {
  const authorization = headerValue(request, 'authorization')
  if (authorization === null || !authorization.startsWith('Bearer ')) return false
  return constantTimeEqual(authorization.slice(7), authToken)
}

function rejectRequest(response: ServerResponse, statusCode: number, error: string): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error }))
}

export async function startHttpServer(client: CollectorClient, options: HttpServerOptions): Promise<HttpServerHandle> {
  const allowedOrigins = options.allowedOrigins ?? []
  const authToken = options.authToken
  const server = createMcpServer(client)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
  await server.connect(transport as Transport)

  const httpServer = createServer((request, response) => {
    if (!isAllowedOrigin(request, allowedOrigins)) {
      rejectRequest(response, 403, 'forbidden-origin')
      return
    }
    if (authToken !== undefined && !hasValidBearer(request, authToken)) {
      rejectRequest(response, 401, 'unauthorized')
      return
    }
    void transport.handleRequest(request, response)
  })

  const boundPort = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.port, options.host ?? '127.0.0.1', () => {
      const address = httpServer.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('mcp http server failed to bind'))
        return
      }
      resolve(address.port)
    })
  })

  return {
    port: boundPort,
    async close() {
      await server.close()
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  }
}
