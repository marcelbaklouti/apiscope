import {
  PROTOCOL_VERSION,
  encodeWireMessage,
  type AppMetadata,
  type RouteRegistryEntry,
  type SpanBatchPayload
} from '@apiscope/core'

export interface HttpCollectorTransportOptions {
  collectorUrl: string
  app: AppMetadata
}

export class HttpCollectorTransport {
  private handshakeDone = false
  private pendingDropped = 0
  private ingestUrl: string

  constructor(private readonly options: HttpCollectorTransportOptions) {
    this.ingestUrl = `${options.collectorUrl.replace(/\/$/, '')}/ingest`
  }

  async ensureHandshake(routes: RouteRegistryEntry[]): Promise<void> {
    if (this.handshakeDone) return
    try {
      const response = await fetch(this.ingestUrl, {
        method: 'POST',
        body: encodeWireMessage({
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          app: this.options.app,
          routes
        })
      })
      if (response.status === 202) this.handshakeDone = true
    } catch {}
  }

  async sendBatch(batch: SpanBatchPayload): Promise<void> {
    const droppedCount = batch.droppedCount + this.pendingDropped
    try {
      const response = await fetch(this.ingestUrl, {
        method: 'POST',
        headers: { 'x-apiscope-app': this.options.app.name },
        body: encodeWireMessage({
          type: 'span-batch',
          protocolVersion: PROTOCOL_VERSION,
          spans: batch.spans,
          childSpans: batch.childSpans,
          droppedCount
        })
      })
      if (response.status === 202) this.pendingDropped = 0
      else this.pendingDropped = droppedCount + batch.spans.length + batch.childSpans.length
    } catch {
      this.pendingDropped = droppedCount + batch.spans.length + batch.childSpans.length
    }
  }
}
