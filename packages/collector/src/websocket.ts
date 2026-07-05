import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { IngestProcessor, type IngestSession } from './ingest'
import { LiveHub } from './live-hub'

export function attachWebSockets(server: Server, processor: IngestProcessor, hub: LiveHub): void {
  const ingestServer = new WebSocketServer({ noServer: true })
  const liveServer = new WebSocketServer({ noServer: true })

  ingestServer.on('connection', (socket: WebSocket) => {
    const session: IngestSession = { appName: null }
    socket.on('message', (data) => {
      const result = processor.process(String(data), session)
      if (result.ok) socket.send(JSON.stringify({ accepted: true }))
      else socket.send(JSON.stringify({ error: result.error }))
    })
    socket.on('close', () => {
      if (session.appName !== null) hub.publish({ type: 'app-disconnected', appName: session.appName })
    })
  })

  liveServer.on('connection', (socket: WebSocket) => {
    const unsubscribe = hub.subscribe((event) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event))
    })
    socket.on('close', unsubscribe)
  })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/ws/ingest') {
      ingestServer.handleUpgrade(request, socket, head, (client) => ingestServer.emit('connection', client, request))
    } else if (url.pathname === '/ws/live') {
      liveServer.handleUpgrade(request, socket, head, (client) => liveServer.emit('connection', client, request))
    } else {
      socket.destroy()
    }
  })

  server.on('close', () => {
    ingestServer.close()
    liveServer.close()
  })
}
