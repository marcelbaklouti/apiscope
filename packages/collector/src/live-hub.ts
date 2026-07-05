import type { LiveEvent } from './live-events'
import type { LiveTransport } from './live/live-transport'

export class InProcessLiveTransport implements LiveTransport {
  private readonly listeners = new Set<(event: LiveEvent) => void>()

  publish(event: LiveEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  subscribe(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async close(): Promise<void> {
    this.listeners.clear()
  }
}

export { InProcessLiveTransport as LiveHub }
