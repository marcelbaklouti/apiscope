import type { Server } from 'node:http'
import { createHttpServer, sendJson, type CollectorOptions, type RouteHandler } from './server'

export type { CollectorOptions }

export interface Collector {
  listen(): Promise<{ host: string; port: number }>
  close(): Promise<void>
}

export function createCollector(options: CollectorOptions): Collector {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 4620
  const routes = new Map<string, RouteHandler>()
  routes.set('GET /health', (request, response) => sendJson(response, 200, { status: 'ok' }))
  const server: Server = createHttpServer(routes)
  return {
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
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }
}
