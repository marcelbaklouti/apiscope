import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runWorkerLoop } from '../src/worker-loop'
import type { LoadScenario, WorkerMessage, SampleEntry } from '../src/types'

let server: Server

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function startTarget(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return `http://127.0.0.1:${address.port}`
}

function collectSamples(messages: WorkerMessage[]): SampleEntry[] {
  return messages.flatMap((message) => (message.type === 'samples' ? message.entries : []))
}

describe('runWorkerLoop open model', () => {
  it('generates approximately the scheduled request count and reports health', async () => {
    const baseUrl = await startTarget((request, response) => {
      response.writeHead(200)
      response.end('ok')
    })
    const scenario: LoadScenario = {
      name: 'open',
      baseUrl,
      targets: [{ method: 'GET', path: '/' }],
      model: { kind: 'open', phases: [{ durationMs: 1000, rps: 50 }] }
    }
    const messages: WorkerMessage[] = []
    await runWorkerLoop({ scenario, workerIndex: 0, workerCount: 1 }, (message) => messages.push(message))
    const samples = collectSamples(messages)
    expect(samples.length).toBeGreaterThanOrEqual(40)
    expect(samples.length).toBeLessThanOrEqual(60)
    expect(samples.every((sample) => sample.statusCode === 200)).toBe(true)
    const done = messages.find((message) => message.type === 'done')
    expect(done).toBeDefined()
    expect(done?.type === 'done' && done.eventLoopLagP99Ms).toBeGreaterThanOrEqual(0)
  })

  it('drops warmup samples', async () => {
    const baseUrl = await startTarget((request, response) => {
      response.writeHead(200)
      response.end('ok')
    })
    const scenario: LoadScenario = {
      name: 'warmup',
      baseUrl,
      targets: [{ method: 'GET', path: '/' }],
      model: { kind: 'open', phases: [{ durationMs: 1000, rps: 40 }] },
      warmupMs: 500
    }
    const messages: WorkerMessage[] = []
    await runWorkerLoop({ scenario, workerIndex: 0, workerCount: 1 }, (message) => messages.push(message))
    const samples = collectSamples(messages)
    expect(samples.length).toBeGreaterThanOrEqual(12)
    expect(samples.length).toBeLessThanOrEqual(28)
  })

  it('records connection errors as status 0 samples', async () => {
    const scenario: LoadScenario = {
      name: 'errors',
      baseUrl: 'http://127.0.0.1:1',
      targets: [{ method: 'GET', path: '/' }],
      model: { kind: 'open', phases: [{ durationMs: 400, rps: 20 }] }
    }
    const messages: WorkerMessage[] = []
    await runWorkerLoop({ scenario, workerIndex: 0, workerCount: 1 }, (message) => messages.push(message))
    const samples = collectSamples(messages)
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.every((sample) => sample.statusCode === 0 && sample.errorMessage !== undefined)).toBe(true)
  })
})

describe('runWorkerLoop closed model', () => {
  it('runs sequential loops until the deadline', async () => {
    const baseUrl = await startTarget((request, response) => {
      setTimeout(() => {
        response.writeHead(200)
        response.end('ok')
      }, 20)
    })
    const scenario: LoadScenario = {
      name: 'closed',
      baseUrl,
      targets: [{ method: 'GET', path: '/' }],
      model: { kind: 'closed', concurrency: 4, durationMs: 600 }
    }
    const messages: WorkerMessage[] = []
    await runWorkerLoop({ scenario, workerIndex: 0, workerCount: 1 }, (message) => messages.push(message))
    const samples = collectSamples(messages)
    expect(samples.length).toBeGreaterThanOrEqual(60)
    expect(samples.length).toBeLessThanOrEqual(140)
  })
})

describe('runWorkerLoop hooks', () => {
  it('applies beforeRequest replacements from the hooks module', async () => {
    const seenPaths: string[] = []
    const baseUrl = await startTarget((request, response) => {
      seenPaths.push(request.url ?? '')
      response.writeHead(200)
      response.end('ok')
    })
    const hooksDir = mkdtempSync(join(tmpdir(), 'apiscope-hooks-'))
    const hooksPath = join(hooksDir, 'hooks.mjs')
    writeFileSync(
      hooksPath,
      'export function beforeRequest(request, context) { return { ...request, path: `/dynamic/${context.iteration}` } }\n'
    )
    const scenario: LoadScenario = {
      name: 'hooks',
      baseUrl,
      targets: [{ method: 'GET', path: '/static' }],
      model: { kind: 'open', phases: [{ durationMs: 300, rps: 20 }] },
      hooksModule: hooksPath
    }
    const messages: WorkerMessage[] = []
    await runWorkerLoop({ scenario, workerIndex: 0, workerCount: 1 }, (message) => messages.push(message))
    expect(seenPaths.length).toBeGreaterThan(0)
    expect(seenPaths.every((path) => path.startsWith('/dynamic/'))).toBe(true)
  })
})

describe('runWorkerLoop trace context injection', () => {
  it('injects traceparent and load-run headers, after hooks run', async () => {
    const seen: Array<{ traceparent: string; loadRun: string }> = []
    const baseUrl = await startTarget((request, response) => {
      seen.push({
        traceparent: String(request.headers.traceparent ?? ''),
        loadRun: String(request.headers['apiscope-load-run'] ?? '')
      })
      response.writeHead(200)
      response.end('ok')
    })
    const hooksDir = mkdtempSync(join(tmpdir(), 'apiscope-hooks-'))
    const hooksPath = join(hooksDir, 'hooks.mjs')
    writeFileSync(
      hooksPath,
      "export function beforeRequest(request) { return { ...request, headers: { ...(request.headers ?? {}), traceparent: 'should-be-overridden', 'apiscope-load-run': 'should-be-overridden' } } }\n"
    )
    const scenario: LoadScenario = {
      name: 'trace-injection',
      baseUrl,
      targets: [{ method: 'GET', path: '/' }],
      model: { kind: 'open', phases: [{ durationMs: 200, rps: 10 }] },
      hooksModule: hooksPath
    }
    const messages: WorkerMessage[] = []
    await runWorkerLoop({ scenario, workerIndex: 0, workerCount: 1, runId: 'run1run1run1run1' }, (message) =>
      messages.push(message)
    )
    expect(seen.length).toBeGreaterThan(0)
    for (const entry of seen) {
      expect(entry.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
      expect(entry.loadRun).toBe('run1run1run1run1')
    }
    const traceIds = new Set(seen.map((entry) => entry.traceparent.split('-')[1]))
    expect(traceIds.size).toBe(seen.length)
    const samples = collectSamples(messages)
    expect(samples.length).toBe(seen.length)
    expect(samples.every((sample) => sample.traceId !== undefined && /^[0-9a-f]{32}$/.test(sample.traceId))).toBe(true)
  })
})
