import { afterEach, describe, expect, it } from 'vitest'
import { createCollector, type Collector } from '../src/index'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

const secretBearingConfig = {
  collector: { host: '0.0.0.0', port: 4620, retentionRows: 5000, storage: { driver: 'clickhouse', url: 'https://ch.internal', username: 'admin', password: 'super-secret-password' } },
  production: {
    ingestAuth: { mode: 'token', tokens: [{ appName: 'web', token: 'ingest-token-abc123' }] },
    dashboardAuth: {
      mode: 'password',
      sessionSecret: 'top-secret-session-signing-key',
      users: [{ username: 'admin', passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$hash', displayName: 'Admin' }]
    },
    tls: { key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', cert: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----' },
    sampling: { mode: 'tail', baseProbability: 0.1 }
  },
  otlp: { export: { endpoint: 'https://otel.internal', protocol: 'http/json', headers: { authorization: 'Bearer otlp-secret-header' } } }
}

function flattenValues(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') acc.push(value)
  else if (Array.isArray(value)) for (const entry of value) flattenValues(entry, acc)
  else if (value !== null && typeof value === 'object') for (const entry of Object.values(value)) flattenValues(entry, acc)
  return acc
}

describe('GET /api/meta', () => {
  it('never serves secret material from the production or otlp config blocks', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, meta: secretBearingConfig })
    const { port } = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${port}/api/meta`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { meta: unknown }
    const allValues = flattenValues(body.meta)
    const secrets = [
      'super-secret-password',
      'ingest-token-abc123',
      'top-secret-session-signing-key',
      '$argon2id$v=19$m=65536,t=3,p=4$hash',
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
      'Bearer otlp-secret-header'
    ]
    for (const secret of secrets) expect(allValues).not.toContain(secret)
  })

  it('still exposes the safe, non-secret fields dashboards rely on', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, meta: secretBearingConfig })
    const { port } = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${port}/api/meta`)
    const body = (await response.json()) as { meta: { collector?: { retentionRows?: number; storage?: { driver?: string } }; production?: { sampling?: { mode?: string } } } }
    expect(body.meta.collector?.retentionRows).toBe(5000)
    expect(body.meta.collector?.storage?.driver).toBe('clickhouse')
    expect(body.meta.production?.sampling?.mode).toBe('tail')
  })

  it('returns null when no meta was configured', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    const response = await fetch(`http://127.0.0.1:${port}/api/meta`)
    expect(await response.json()).toEqual({ meta: null })
  })
})
