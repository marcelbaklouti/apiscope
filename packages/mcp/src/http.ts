import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CollectorClient } from './client'
import { createMcpServer } from './server'

export interface HttpServerOptions {
  port: number
  host?: string
}

export interface HttpServerHandle {
  port: number
  close(): Promise<void>
}

export async function startHttpServer(client: CollectorClient, options: HttpServerOptions): Promise<HttpServerHandle> {
  const server = createMcpServer(client)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
  await server.connect(transport as Transport)

  const httpServer = createServer((request, response) => {
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
