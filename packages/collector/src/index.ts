import type { Server } from 'node:http'
import { SpanStore } from './store'
import { createHttpServer, sendJson, type CollectorOptions, type RouteHandler } from './server'

export type { CollectorOptions }
export { SpanStore } from './store'
export type { RouteStats } from './store'

export interface Collector {
  listen(): Promise<{ host: string; port: number }>
  close(): Promise<void>
  store: SpanStore
}

export function createCollector(options: CollectorOptions): Collector {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 4620
  const storeOptions = options.retentionRows === undefined ? {} : { retentionRows: options.retentionRows }
  const store = new SpanStore(options.dbPath, storeOptions)
  const routes = new Map<string, RouteHandler>()
  routes.set('GET /health', (request, response) => sendJson(response, 200, { status: 'ok' }))
  const server: Server = createHttpServer(routes)
  return {
    store,
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
