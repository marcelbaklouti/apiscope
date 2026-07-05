import { decodeWireMessage, type DecodeError } from '@apiscope/core'
import { LiveHub } from './live-hub'
import type { SpanStore } from './store-interface'

export interface IngestSession {
  appName: string | null
}

export type IngestResult = { ok: true; appName: string } | { ok: false; error: DecodeError | { kind: 'missing-app' } }

export class IngestProcessor {
  constructor(
    private readonly store: SpanStore,
    private readonly hub: LiveHub
  ) {}

  async process(raw: string, session: IngestSession): Promise<IngestResult> {
    const decoded = decodeWireMessage(raw)
    if (!decoded.ok) return { ok: false, error: decoded.error }
    const message = decoded.message
    if (message.type === 'handshake') {
      session.appName = message.app.name
      await this.store.replaceRoutes(message.app.name, message.routes)
      this.hub.publish({ type: 'app-connected', app: message.app })
      this.hub.publish({ type: 'registry', appName: message.app.name, routes: message.routes })
      return { ok: true, appName: message.app.name }
    }
    if (session.appName === null) return { ok: false, error: { kind: 'missing-app' } }
    const appName = session.appName
    if (message.type === 'registry-update') {
      await this.store.replaceRoutes(appName, message.routes)
      this.hub.publish({ type: 'registry', appName, routes: message.routes })
      return { ok: true, appName }
    }
    await this.store.insertBatch(appName, { spans: message.spans, childSpans: message.childSpans })
    this.hub.publish({ type: 'spans', appName, spans: message.spans, childSpans: message.childSpans })
    if (message.droppedCount > 0) this.hub.publish({ type: 'dropped', appName, droppedCount: message.droppedCount })
    return { ok: true, appName }
  }
}
