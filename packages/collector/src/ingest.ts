import { decodeWireMessage, type ChildSpan, type DecodeError, type RequestSpan } from '@apiscope/core'
import type { LiveTransport } from './live/live-transport'
import type { CollectorMetrics } from './metrics'
import type { OtlpExporter } from './otlp/exporter'
import type { Sampler } from './sampling/sampler'
import type { SpanStore } from './store-interface'

export interface IngestSession {
  appName: string | null
  authenticatedApp?: string | null
}

export type IngestResult = { ok: true; appName: string } | { ok: false; error: DecodeError | { kind: 'missing-app' } }

export class IngestProcessor {
  constructor(
    private readonly store: SpanStore,
    private readonly hub: LiveTransport,
    private readonly sampler: Sampler,
    private readonly metrics: CollectorMetrics,
    private readonly exporter?: OtlpExporter
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
    const keptSpans: RequestSpan[] = []
    const keptIds = new Set<string>()
    let droppedBySampler = 0
    for (const span of message.spans) {
      if (this.sampler.keep(span)) {
        keptSpans.push(span)
        keptIds.add(span.id)
      } else {
        droppedBySampler += 1
      }
    }
    const keptChildSpans: ChildSpan[] = message.childSpans.filter((child) => keptIds.has(child.parentSpanId))
    const insertStart = process.hrtime.bigint()
    await this.store.insertBatch(appName, { spans: keptSpans, childSpans: keptChildSpans })
    const insertSeconds = Number(process.hrtime.bigint() - insertStart) / 1e9
    if (this.exporter !== undefined && (keptSpans.length > 0 || keptChildSpans.length > 0)) {
      void this.exporter.export(keptSpans, keptChildSpans)
    }
    this.metrics.observeInsertSeconds(insertSeconds)
    this.metrics.recordIngestedSpans(appName, keptSpans.length)
    const totalDropped = message.droppedCount + droppedBySampler
    this.metrics.recordDroppedSpans(appName, totalDropped)
    for (const span of keptSpans) this.metrics.recordRequest(appName, span.statusCode)
    if (keptSpans.length > 0 || keptChildSpans.length > 0) {
      this.hub.publish({ type: 'spans', appName, spans: keptSpans, childSpans: keptChildSpans })
    }
    if (totalDropped > 0) this.hub.publish({ type: 'dropped', appName, droppedCount: totalDropped })
    return { ok: true, appName }
  }
}
