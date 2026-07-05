import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { runLoadTestInProcess } from '../src/run'
import type { LoadScenario } from '../src/types'

let server: Server | undefined

afterEach(async () => {
  if (server === undefined) return
  await new Promise<void>((resolve) => server?.close(() => resolve()))
})

async function startTarget(delayMs: number): Promise<string> {
  server = createServer((request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
    }, delayMs)
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return `http://127.0.0.1:${address.port}`
}

describe('runLoadTestInProcess', () => {
  it('rejects non-localhost targets before sending anything', async () => {
    const scenario: LoadScenario = {
      name: 'forbidden',
      baseUrl: 'https://api.example.com',
      targets: [{ method: 'GET', path: '/' }],
      model: { kind: 'open', phases: [{ durationMs: 100, rps: 10 }] }
    }
    await expect(runLoadTestInProcess(scenario)).rejects.toThrow(/api\.example\.com/)
  })

  it('produces percentiles matching a known latency distribution', async () => {
    const baseUrl = await startTarget(25)
    const scenario: LoadScenario = {
      name: 'reference',
      baseUrl,
      targets: [{ method: 'GET', path: '/' }],
      model: { kind: 'open', phases: [{ durationMs: 2000, rps: 60 }] },
      warmupMs: 250
    }
    const progressSnapshots: number[] = []
    const result = await runLoadTestInProcess(scenario, {
      onProgress: (snapshot) => progressSnapshots.push(snapshot.totalRequests)
    })
    expect(result.aborted).toBe(false)
    expect(result.errorRate).toBe(0)
    expect(result.latency.p50).toBeGreaterThanOrEqual(20)
    expect(result.latency.p50).toBeLessThanOrEqual(90)
    expect(result.totalRequests).toBeGreaterThanOrEqual(80)
    expect(result.achievedRps).toBeGreaterThan(30)
    expect(progressSnapshots.length).toBeGreaterThan(0)
    expect(result.workerHealth.eventLoopLagP99Ms).toBeGreaterThanOrEqual(0)
  })

  it('exposes coordinated omission through intended-time latency', async () => {
    let stallUntil = 0
    server = createServer((request, response) => {
      const respond = () => {
        response.writeHead(200)
        response.end('ok')
      }
      const remaining = stallUntil - Date.now()
      if (remaining > 0) setTimeout(respond, remaining)
      else respond()
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no address')
    setTimeout(() => {
      stallUntil = Date.now() + 400
    }, 500)
    const scenario: LoadScenario = {
      name: 'stall',
      baseUrl: `http://127.0.0.1:${address.port}`,
      targets: [{ method: 'GET', path: '/' }],
      model: { kind: 'open', phases: [{ durationMs: 1500, rps: 100 }] }
    }
    const result = await runLoadTestInProcess(scenario)
    expect(result.latency.p99).toBeGreaterThanOrEqual(150)
  })
})
