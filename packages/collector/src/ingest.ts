import { decodeWireMessage, type DecodeError } from '@apiscope/core'
import { LiveHub } from './live-hub'
import type { SpanStore } from './store-interface'

export interface IngestSession {
  appName: string | null
  authenticatedApp?: string | null
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
      const app =
        session.authenticatedApp !== undefined && session.authenticatedApp !== null && session.authenticatedApp !== ''
          ? { ...message.app, name: session.authenticatedApp }
          : message.app
      session.appName = app.name
      await this.store.replaceRoutes(app.name, message.routes)
      this.hub.publish({ type: 'app-connected', app })
      this.hub.publish({ type: 'registry', appName: app.name, routes: message.routes })
      return { ok: true, appName: app.name }
    }
    const authenticatedApp =
      session.authenticatedApp !== undefined && session.authenticatedApp !== null && session.authenticatedApp !== ''
        ? session.authenticatedApp
        : null
    if (authenticatedApp === null && session.appName === null) return { ok: false, error: { kind: 'missing-app' } }
    const appName = authenticatedApp ?? session.appName ?? ''
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
