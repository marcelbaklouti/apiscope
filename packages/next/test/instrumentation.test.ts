import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestSpan, RouteRegistryEntry } from '@apiscope/core'
import { AdapterRuntime } from '@apiscope/adapter-node'
import type { CollectorTransport } from '@apiscope/adapter-node'
import { watchRoutes, withApiscope } from '../src/index'

function writeFixture(root: string, relativePath: string, content: string): void {
  const filePath = join(root, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function runtimeWithSinks() {
  const spans: RequestSpan[] = []
  const routePushes: RouteRegistryEntry[][] = []
  const transport = {
    start: vi.fn(),
    setRoutes: (routes: RouteRegistryEntry[]) => routePushes.push(routes),
    sendBatch: vi.fn(),
    stop: vi.fn(async () => {})
  } as unknown as CollectorTransport
  const runtime = new AdapterRuntime({ appName: 'next-demo', framework: 'next', transport })
  const originalRecord = runtime.recordSpan.bind(runtime)
  runtime.recordSpan = (span) => {
    spans.push(span)
    originalRecord(span)
  }
  return { runtime, spans, routePushes }
}

describe('withApiscope', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('registers routes on register and records error spans via onRequestError', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'apiscope-next-app-'))
    writeFixture(projectDir, 'app/api/users/[id]/route.ts', 'export async function GET() {}')
    const { runtime, spans, routePushes } = runtimeWithSinks()
    const adapter = withApiscope({ appName: 'next-demo', projectDir, runtime })
    await adapter.register()
    expect(routePushes[0]).toContainEqual({
      method: 'GET',
      pattern: '/api/users/:id',
      sourceFile: 'app/api/users/[id]/route.ts'
    })
    await adapter.onRequestError(
      Object.assign(new Error('render failed'), { digest: 'DIGEST_1' }),
      { path: '/api/users/7', method: 'GET' },
      {}
    )
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      routePattern: '/api/users/:id',
      actualPath: '/api/users/7',
      statusCode: 500,
      error: { message: 'render failed', digest: 'DIGEST_1' }
    })
    await runtime.shutdown()
  })

  it('does nothing outside the nodejs runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    const { runtime, routePushes } = runtimeWithSinks()
    const adapter = withApiscope({ appName: 'next-demo', projectDir: tmpdir(), runtime })
    await adapter.register()
    expect(routePushes).toHaveLength(0)
    await runtime.shutdown()
  })
})

describe('watchRoutes', () => {
  it('debounces change notifications', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'apiscope-next-watch-'))
    mkdirSync(join(projectDir, 'app'), { recursive: true })
    const onChange = vi.fn()
    const stop = watchRoutes(projectDir, onChange)
    writeFixture(projectDir, 'app/api/one/route.ts', 'export function GET() {}')
    writeFixture(projectDir, 'app/api/two/route.ts', 'export function GET() {}')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 })
    expect(onChange.mock.calls.length).toBeLessThanOrEqual(2)
    stop()
  })
})
