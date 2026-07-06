import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { isAllowedOrigin } from './origin'
import type { DashboardAuthenticator } from './auth/dashboard-auth'
import { createNoneIngestAuthenticator, type IngestAuthenticator } from './auth/ingest-auth'
import { IngestProcessor, type IngestSession } from './ingest'
import type { LiveTransport } from './live/live-transport'
import type { CollectorMetrics } from './metrics'
import type { ProfileChannelRegistry } from './profiles/registry'

const DEFAULT_MAX_WS_PAYLOAD_BYTES = 8 * 1024 * 1024

export interface WebSocketOptions {
  allowedOrigins?: string[]
  maxPayload?: number
}

export function attachWebSockets(
  server: Server,
  processor: IngestProcessor,
  hub: LiveTransport,
  ingestAuth: IngestAuthenticator = createNoneIngestAuthenticator(),
  metrics?: CollectorMetrics,
  profileChannel?: ProfileChannelRegistry,
  dashboardAuth?: DashboardAuthenticator,
  options: WebSocketOptions = {}
): void {
  const allowedOrigins = options.allowedOrigins ?? []
  const maxPayload = options.maxPayload ?? DEFAULT_MAX_WS_PAYLOAD_BYTES
  const ingestServer = new WebSocketServer({ noServer: true, maxPayload })
  const liveServer = new WebSocketServer({ noServer: true, maxPayload })
  let liveSubscriberCount = 0

  ingestServer.on('connection', (socket: WebSocket, request) => {
    const authenticatedApp = (request as { apiscopeAuthenticatedApp?: string | null }).apiscopeAuthenticatedApp ?? null
    const session: IngestSession = { appName: null, authenticatedApp }
    socket.on('message', (data) => {
      if (profileChannel?.handleInboundMessage(String(data)) === true) return
      void processor.process(String(data), session).then((result) => {
        if (result.ok && session.appName !== null) profileChannel?.registerApp(session.appName, socket)
        if (result.ok) socket.send(JSON.stringify({ accepted: true }))
        else socket.send(JSON.stringify({ error: result.error }))
      })
    })
    socket.on('close', () => {
      if (session.appName !== null) {
        hub.publish({ type: 'app-disconnected', appName: session.appName })
        profileChannel?.unregisterApp(session.appName)
      }
    })
  })

  liveServer.on('connection', (socket: WebSocket) => {
    liveSubscriberCount += 1
    metrics?.setLiveSubscribers(liveSubscriberCount)
    const unsubscribe = hub.subscribe((event) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event))
    })
    socket.on('close', () => {
      unsubscribe()
      liveSubscriberCount -= 1
      metrics?.setLiveSubscribers(liveSubscriberCount)
    })
  })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/ws/ingest' || url.pathname === '/ws/live') {
      if (!isAllowedOrigin(request as IncomingMessage, allowedOrigins)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
    }
    if (url.pathname === '/ws/ingest') {
      const identity = ingestAuth.authenticate(request)
      if (identity === null) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      ;(request as { apiscopeAuthenticatedApp?: string | null }).apiscopeAuthenticatedApp = identity.appName === '' ? null : identity.appName
      ingestServer.handleUpgrade(request, socket, head, (client) => ingestServer.emit('connection', client, request))
    } else if (url.pathname === '/ws/live') {
      if (dashboardAuth === undefined) {
        liveServer.handleUpgrade(request, socket, head, (client) => liveServer.emit('connection', client, request))
        return
      }
      void dashboardAuth.authenticate(request).then((identity) => {
        if (identity === null) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
          return
        }
        liveServer.handleUpgrade(request, socket, head, (client) => liveServer.emit('connection', client, request))
      })
    } else {
      socket.destroy()
    }
  })

  server.on('close', () => {
    ingestServer.close()
    liveServer.close()
  })
}
