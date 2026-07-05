import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatIssuePath, loadConfig } from '../src/config'

function writeConfig(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'apiscope-config-'))
  const configPath = join(directory, 'apiscope.config.ts')
  writeFileSync(configPath, content)
  return configPath
}

describe('formatIssuePath', () => {
  it('joins segments with dots and index brackets', () => {
    expect(formatIssuePath(['ci', 'scenarios', 0, 'assertions', 'p95MaxMs'])).toBe(
      'ci.scenarios[0].assertions.p95MaxMs'
    )
    expect(formatIssuePath([])).toBe('config')
  })
})

describe('loadConfig', () => {
  it('loads a valid typescript config with defineConfig', async () => {
    const configPath = writeConfig(`
      const config = {
        collector: { port: 4620 },
        ci: {
          readiness: { url: 'http://127.0.0.1:3000/health' },
          scenarios: [
            {
              scenario: {
                name: 'smoke',
                baseUrl: 'http://127.0.0.1:3000',
                targets: [{ method: 'GET', path: '/api/users' }],
                model: { kind: 'open', phases: [{ durationMs: 1000, rps: 50 }] }
              },
              assertions: { p95MaxMs: 120, errorRateMax: 0.01 }
            }
          ]
        }
      }
      export default config
    `)
    const config = await loadConfig(configPath)
    expect(config.ci?.scenarios[0]?.scenario.name).toBe('smoke')
    expect(config.ci?.scenarios[0]?.assertions?.p95MaxMs).toBe(120)
  })

  it('reports the exact path for invalid values', async () => {
    const configPath = writeConfig(`
      export default {
        ci: {
          readiness: { url: 'http://127.0.0.1:3000/health' },
          scenarios: [
            {
              scenario: {
                name: 'bad',
                baseUrl: 'http://127.0.0.1:3000',
                targets: [{ method: 'GET', path: '/x' }],
                model: { kind: 'open', phases: [{ durationMs: 1000, rps: 10 }] }
              },
              assertions: { p95MaxMs: 'fast' }
            }
          ]
        }
      }
    `)
    await expect(loadConfig(configPath)).rejects.toThrow(/ci\.scenarios\[0\]\.assertions\.p95MaxMs/)
  })

  it('rejects configs without default export', async () => {
    const configPath = writeConfig(`export const config = {}`)
    await expect(loadConfig(configPath)).rejects.toThrow(/default export/)
  })

  it('loads a config with otlp export (grpc) and ingest (http+grpc) blocks', async () => {
    const configPath = writeConfig(`
      const config = {
        otlp: {
          export: { endpoint: 'http://127.0.0.1:4317', protocol: 'grpc', headers: { authorization: 'Bearer abc' } },
          ingest: { http: true, grpc: true, grpcPort: 4317, appName: 'imported' }
        }
      }
      export default config
    `)
    const config = await loadConfig(configPath)
    expect(config.otlp?.export?.protocol).toBe('grpc')
    expect(config.otlp?.export?.endpoint).toBe('http://127.0.0.1:4317')
    expect(config.otlp?.ingest?.http).toBe(true)
    expect(config.otlp?.ingest?.grpc).toBe(true)
    expect(config.otlp?.ingest?.grpcPort).toBe(4317)
  })

  it('reports the exact path for an invalid otlp export protocol', async () => {
    const configPath = writeConfig(`
      export default {
        otlp: {
          export: { endpoint: 'http://127.0.0.1:4318', protocol: 'carrier-pigeon' }
        }
      }
    `)
    await expect(loadConfig(configPath)).rejects.toThrow(/otlp\.export\.protocol/)
  })
})
