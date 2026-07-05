import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '@apiscope/collector'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'app-demo')

let collector: Collector
let nextProcess: ChildProcess
let nextPort = 0

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('no port'))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`timeout waiting for ${url}`)
}

beforeAll(async () => {
  collector = createCollector({ dbPath: ':memory:', port: 0 })
  const collectorAddress = await collector.listen()
  nextPort = await freePort()
  nextProcess = spawn('pnpm', ['exec', 'next', 'dev', '-p', String(nextPort)], {
    cwd: fixtureDir,
    env: {
      ...process.env,
      APISCOPE_COLLECTOR_URL: `ws://127.0.0.1:${collectorAddress.port}`
    },
    stdio: 'inherit'
  })
  await waitForHttp(`http://127.0.0.1:${nextPort}`, 90000)
}, 120000)

afterAll(async () => {
  nextProcess.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 1000))
  await collector.close()
})

describe('next dev end to end', () => {
  it('records api route spans with matched patterns', async () => {
    const response = await fetch(`http://127.0.0.1:${nextPort}/api/hello/marcel`)
    expect(response.status).toBe(200)
    await vi.waitFor(
      async () => {
        const span = (await collector.store.recentSpans(50)).find((entry) => entry.actualPath === '/api/hello/marcel')
        expect(span).toBeDefined()
        expect(span?.routePattern).toBe('/api/hello/:name')
        expect(span?.framework).toBe('next')
        expect(span?.statusCode).toBe(200)
      },
      { timeout: 15000 }
    )
  })

  it('registers the scanned route in the collector', async () => {
    await vi.waitFor(
      async () =>
        expect(await collector.store.listRoutes()).toContainEqual({
          appName: 'next-fixture',
          method: 'GET',
          pattern: '/api/hello/:name',
          sourceFile: 'app/api/hello/[name]/route.ts'
        }),
      { timeout: 15000 }
    )
  })
})
