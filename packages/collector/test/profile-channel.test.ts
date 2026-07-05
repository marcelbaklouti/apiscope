import { afterEach, describe, expect, it } from 'vitest'
import { CollectorTransport } from '@apiscope/adapter-node'
import { createCollector, type Collector } from '../src/index'

let collector: Collector
let transport: CollectorTransport | undefined

afterEach(async () => {
  await transport?.stop()
  await collector.close()
})

function busy(millis: number): void {
  const end = Date.now() + millis
  let value = 0
  while (Date.now() < end) value += Math.sqrt(value + 1)
  if (value === -1) throw new Error('unreachable')
}

describe('bidirectional profile control channel', () => {
  it('requests a cpu profile from a connected app and returns a flamegraph', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    transport = new CollectorTransport({
      collectorUrl: `ws://127.0.0.1:${port}`,
      app: { name: 'profiled-app', framework: 'express', runtime: 'node' }
    })
    transport.start()
    await new Promise<void>((resolve) => {
      const check = () => (collector.connectedApp('profiled-app') !== null ? resolve() : setTimeout(check, 10))
      check()
    })

    const resultPromise = collector.requestProfile('profiled-app', 300)
    await new Promise((resolve) => setTimeout(resolve, 20))
    busy(250)
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(result.flamegraph?.value).toBeGreaterThan(0)
    expect(result.flamegraph?.children.length ?? 0).toBeGreaterThan(0)
    expect(result.pprofBase64).toBeDefined()
  }, 15000)

  it('rejects a profile request for an app that is not connected', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    await collector.listen()
    await expect(collector.requestProfile('missing-app', 100)).rejects.toThrow(/not connected/i)
  })
})
