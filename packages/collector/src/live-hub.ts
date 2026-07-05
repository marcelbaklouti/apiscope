import type { AppMetadata, ChildSpan, RequestSpan, RouteRegistryEntry } from '@apiscope/core'

export type LiveEvent =
  | { type: 'spans'; appName: string; spans: RequestSpan[]; childSpans: ChildSpan[] }
  | { type: 'registry'; appName: string; routes: RouteRegistryEntry[] }
  | { type: 'app-connected'; app: AppMetadata }
  | { type: 'app-disconnected'; appName: string }
  | { type: 'dropped'; appName: string; droppedCount: number }

export class LiveHub {
  private readonly listeners = new Set<(event: LiveEvent) => void>()

  subscribe(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(event: LiveEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
