import { afterEach, describe, expect, it } from 'vitest'
import { createCollector } from '../src/index'
import type { Collector } from '../src/index'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

describe('createCollector', () => {
  it('serves a health endpoint on an ephemeral port', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const address = await collector.listen()
    expect(address.host).toBe('127.0.0.1')
    const response = await fetch(`http://127.0.0.1:${address.port}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('returns 404 for unknown paths', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const address = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${address.port}/nope`)
    expect(response.status).toBe(404)
  })
})
