import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey'
import { createValkeyLiveTransport } from '../src/live/valkey-transport'
import type { LiveTransport } from '../src/live/live-transport'

describe.skipIf(process.env.APISCOPE_SKIP_CONTAINERS === 'true')('valkey live transport', () => {
  let container: StartedValkeyContainer
  let url = ''

  beforeAll(async () => {
    container = await new ValkeyContainer('valkey/valkey:8').start()
    url = container.getConnectionUrl()
  }, 120000)

  afterAll(async () => {
    await container.stop()
  })

  it('delivers events published on one instance to subscribers on another', async () => {
    const publisher: LiveTransport = await createValkeyLiveTransport({ url, channel: 'apiscope:test' })
    const subscriber: LiveTransport = await createValkeyLiveTransport({ url, channel: 'apiscope:test' })
    const received: unknown[] = []
    subscriber.subscribe((event) => received.push(event))
    await new Promise((resolve) => setTimeout(resolve, 200))
    publisher.publish({ type: 'dropped', appName: 'web', droppedCount: 3 })
    await vi.waitFor(() => expect(received).toContainEqual({ type: 'dropped', appName: 'web', droppedCount: 3 }), { timeout: 5000 })
    await publisher.close()
    await subscriber.close()
  }, 30000)
})
