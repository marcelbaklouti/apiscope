import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector, type LiveEvent } from '../src/index'

let collector: Collector
let target: Server

afterEach(async () => {
  await collector.close()
  if (target?.listening) await new Promise<void>((resolve) => target.close(() => resolve()))
})

async function startTarget(): Promise<string> {
  target = createServer((request, response) => {
    response.writeHead(200)
    response.end('ok')
  })
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
  const address = target.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return `http://127.0.0.1:${address.port}`
}

describe('load run api', () => {
  it('executes a run, streams progress and persists the result', async () => {
    const targetUrl = await startTarget()
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const events: LiveEvent[] = []
    collector.hub.subscribe((event) => {
      if (event.type === 'load-progress' || event.type === 'load-finished') events.push(event)
    })
    const response = await fetch(`http://127.0.0.1:${port}/api/load-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: {
          name: 'ui-run',
          baseUrl: targetUrl,
          targets: [{ method: 'GET', path: '/' }],
          model: { kind: 'open', phases: [{ durationMs: 600, rps: 30 }] }
        },
        assertions: { errorRateMax: 0.1 }
      })
    })
    expect(response.status).toBe(202)
    const { runId } = (await response.json()) as { runId: string }
    await vi.waitFor(
      () => expect(events.some((event) => event.type === 'load-finished' && event.runId === runId)).toBe(true),
      { timeout: 10000 }
    )
    expect(events.some((event) => event.type === 'load-progress')).toBe(true)
    const list = (await (await fetch(`http://127.0.0.1:${port}/api/load-runs`)).json()) as Array<{ id: string }>
    expect(list.map((entry) => entry.id)).toContain(runId)
    const detail = (await (await fetch(`http://127.0.0.1:${port}/api/load-runs/${runId}`)).json()) as {
      name: string
      assertions: { errorRateMax: number }
      result: { totalRequests: number }
    }
    expect(detail.name).toBe('ui-run')
    expect(detail.assertions.errorRateMax).toBe(0.1)
    expect(detail.result.totalRequests).toBeGreaterThan(0)
  }, 15000)

  it('rejects disallowed targets with 400', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${port}/api/load-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: {
          name: 'bad',
          baseUrl: 'https://api.example.com',
          targets: [{ method: 'GET', path: '/' }],
          model: { kind: 'open', phases: [{ durationMs: 100, rps: 5 }] }
        }
      })
    })
    expect(response.status).toBe(400)
  })

  it('serves the safe projection of meta', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, meta: { collector: { retentionRows: 42 } } })
    const { port } = await collector.listen()
    expect(await (await fetch(`http://127.0.0.1:${port}/api/meta`)).json()).toEqual({
      meta: { collector: { retentionRows: 42 } }
    })
  })
})
