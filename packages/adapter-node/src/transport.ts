import WebSocket from 'ws'
import {
  PROTOCOL_VERSION,
  encodeWireMessage,
  type AppMetadata,
  type RouteRegistryEntry,
  type SpanBatchPayload
} from '@apiscope/core'

export interface CollectorTransportOptions {
  collectorUrl: string
  app: AppMetadata
  reconnectDelayMs?: number
}

export class CollectorTransport {
  private socket: WebSocket | null = null
  private routes: RouteRegistryEntry[] = []
  private discardedWhileDisconnected = 0
  private stopped = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly reconnectDelayMs: number

  constructor(private readonly options: CollectorTransportOptions) {
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  setRoutes(routes: RouteRegistryEntry[]): void {
    this.routes = routes
    this.sendRaw(encodeWireMessage({ type: 'registry-update', protocolVersion: PROTOCOL_VERSION, routes }))
  }

  sendBatch(batch: SpanBatchPayload): void {
    if (!this.isOpen()) {
      this.discardedWhileDisconnected += batch.spans.length + batch.childSpans.length + batch.droppedCount
      return
    }
    const droppedCount = batch.droppedCount + this.discardedWhileDisconnected
    this.discardedWhileDisconnected = 0
    this.sendRaw(
      encodeWireMessage({
        type: 'span-batch',
        protocolVersion: PROTOCOL_VERSION,
        spans: batch.spans,
        childSpans: batch.childSpans,
        droppedCount
      })
    )
  }

  stop(): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    return new Promise((resolve) => {
      const socket = this.socket
      if (socket === null || socket.readyState === WebSocket.CLOSED) {
        resolve()
        return
      }
      socket.once('close', () => resolve())
      socket.close()
    })
  }

  private isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  private sendRaw(payload: string): void {
    if (this.isOpen()) this.socket?.send(payload)
  }

  private ingestUrl(): string {
    const base = this.options.collectorUrl.replace(/\/$/, '')
    return base.endsWith('/ws/ingest') ? base : `${base}/ws/ingest`
  }

  private connect(): void {
    const socket = new WebSocket(this.ingestUrl())
    this.socket = socket
    socket.on('open', () => {
      this.sendRaw(
        encodeWireMessage({
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          app: this.options.app,
          routes: this.routes
        })
      )
    })
    socket.on('message', () => {})
    socket.on('error', () => {})
    socket.on('close', () => {
      this.socket = null
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs)
        this.reconnectTimer.unref?.()
      }
    })
  }
}
