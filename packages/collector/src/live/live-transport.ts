import type { LiveEvent } from '../live-events'

export interface LiveTransport {
  publish(event: LiveEvent): void
  subscribe(listener: (event: LiveEvent) => void): () => void
  close(): Promise<void>
}
