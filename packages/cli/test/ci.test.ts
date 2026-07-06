import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCi } from '../src/ci'
import type { ApiscopeConfig } from '../src/config'

let server: Server

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function startTarget(delayMs: number): Promise<string> {
  server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200)
      response.end('ok')
      return
    }
    setTimeout(() => {
      response.writeHead(200)
      response.end('ok')
    }, delayMs)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return `http://127.0.0.1:${address.port}`
}

function configFor(baseUrl: string, overrides: Partial<NonNullable<ApiscopeConfig['ci']>>): ApiscopeConfig {
  return {
    ci: {
      readiness: { url: `${baseUrl}/health`, timeoutMs: 5000 },
      scenarios: [
        {
          scenario: {
            name: 'smoke',
            baseUrl,
            targets: [{ method: 'GET', path: '/work' }],
            model: { kind: 'open', phases: [{ durationMs: 800, rps: 30 }] }
          },
          assertions: { errorRateMax: 0.05 }
        }
      ],
      ...overrides
    }
  }
}

describe('runCi', () => {
  it('exits 0 when all budgets pass', async () => {
    const baseUrl = await startTarget(5)
    const cwd = mkdtempSync(join(tmpdir(), 'apiscope-ci-'))
    const run = await runCi({ config: configFor(baseUrl, {}), cwd })
    expect(run.exitCode).toBe(0)
    expect(run.reportText).toContain('RESULT: PASS')
  })

  it('exits 1 on budget violation and writes reports', async () => {
    const baseUrl = await startTarget(30)
    const cwd = mkdtempSync(join(tmpdir(), 'apiscope-ci-'))
    const config = configFor(baseUrl, {})
    config.ci!.scenarios[0]!.assertions = { p95MaxMs: 1 }
    const jsonPath = join(cwd, 'report.json')
    const junitPath = join(cwd, 'report.xml')
    const run = await runCi({ config, cwd, jsonPath, junitPath })
    expect(run.exitCode).toBe(1)
    expect(run.reportText).toContain('FAIL  p95MaxMs')
    expect(existsSync(jsonPath)).toBe(true)
    expect(readFileSync(junitPath, 'utf8')).toContain('<failure')
  })

  it('exits 2 when readiness times out', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'apiscope-ci-'))
    const config: ApiscopeConfig = {
      ci: {
        readiness: { url: 'http://127.0.0.1:1/health', timeoutMs: 800, intervalMs: 100 },
        scenarios: [
          {
            scenario: {
              name: 'never',
              baseUrl: 'http://127.0.0.1:1',
              targets: [{ method: 'GET', path: '/' }],
              model: { kind: 'open', phases: [{ durationMs: 100, rps: 5 }] }
            }
          }
        ]
      }
    }
    const run = await runCi({ config, cwd })
    expect(run.exitCode).toBe(2)
  })

  it('exits 2 without ci config', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'apiscope-ci-'))
    const run = await runCi({ config: {}, cwd })
    expect(run.exitCode).toBe(2)
  })

  it('exits 2 when the readiness url is not an allowed target and never probes it', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'apiscope-ci-'))
    const config: ApiscopeConfig = {
      ci: {
        readiness: { url: 'http://169.254.169.254/latest/meta-data/', timeoutMs: 800, intervalMs: 100 },
        scenarios: [
          {
            scenario: {
              name: 'ssrf-readiness',
              baseUrl: 'http://127.0.0.1:3000',
              targets: [{ method: 'GET', path: '/' }],
              model: { kind: 'open', phases: [{ durationMs: 100, rps: 5 }] }
            }
          }
        ]
      }
    }
    const started = Date.now()
    const run = await runCi({ config, cwd })
    expect(run.exitCode).toBe(2)
    expect(run.reportText).toContain('ci.readiness.url')
    expect(Date.now() - started).toBeLessThan(700)
  })

  it('writes a baseline and then detects regressions against it', async () => {
    const fastBaseUrl = await startTarget(5)
    const cwd = mkdtempSync(join(tmpdir(), 'apiscope-ci-'))
    const baselinePath = join(cwd, 'baseline.json')
    const baselineConfig = configFor(fastBaseUrl, { baselinePath, tolerances: { p95Pct: 10 } })
    const writeRun = await runCi({ config: baselineConfig, cwd, updateBaseline: true })
    expect(writeRun.exitCode).toBe(0)
    expect(existsSync(baselinePath)).toBe(true)
    await new Promise<void>((resolve) => server.close(() => resolve()))

    const slowBaseUrl = await startTarget(120)
    const regressionConfig = configFor(slowBaseUrl, { baselinePath, tolerances: { p95Pct: 10 } })
    const regressionRun = await runCi({ config: regressionConfig, cwd })
    expect(regressionRun.exitCode).toBe(1)
    expect(regressionRun.reportText).toContain('vs baseline')
  })
})
