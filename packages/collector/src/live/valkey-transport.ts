import { GlideClient, GlideClientConfiguration } from '@valkey/valkey-glide'
import type { LiveEvent } from '../live-events'
import type { LiveTransport } from './live-transport'

function parseAddress(url: string): { host: string; port: number; useTLS: boolean } {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parsed.port === '' ? 6379 : Number(parsed.port),
    useTLS: parsed.protocol === 'valkeys:' || parsed.protocol === 'rediss:'
  }
}

export async function createValkeyLiveTransport(options: { url: string; channel?: string }): Promise<LiveTransport> {
  const channel = options.channel ?? 'apiscope:live'
  const address = parseAddress(options.url)
  const listeners = new Set<(event: LiveEvent) => void>()

  const publisher = await GlideClient.createClient({
    addresses: [{ host: address.host, port: address.port }],
    useTLS: address.useTLS
  })
  const subscriber = await GlideClient.createClient({
    addresses: [{ host: address.host, port: address.port }],
    useTLS: address.useTLS,
    pubsubSubscriptions: {
      channelsAndPatterns: {
        [GlideClientConfiguration.PubSubChannelModes.Exact]: new Set([channel])
      },
      callback: (message) => {
        const payload = typeof message.message === 'string' ? message.message : message.message.toString()
        try {
          const event = JSON.parse(payload) as LiveEvent
          for (const listener of listeners) listener(event)
        } catch {}
      }
    }
  })

  return {
    publish(event) {
      void publisher.publish(JSON.stringify(event), channel).catch(() => {})
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async close() {
      listeners.clear()
      subscriber.close()
      publisher.close()
    }
  }
}
