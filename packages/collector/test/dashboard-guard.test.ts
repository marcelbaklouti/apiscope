import { afterEach, describe, expect, it } from 'vitest'
import { createDashboardAuthenticator } from '../src/auth/dashboard-auth'
import { createSessionCodec } from '../src/auth/session'
import { createCollector, type Collector } from '../src/index'

let collector: Collector | undefined

afterEach(async () => {
  if (collector === undefined) return
  await collector.close()
})

describe('dashboard guard', () => {
  it('blocks api without a session and allows with one', async () => {
    const sessionSecret = 'guard-test-secret-value-abcdefghijklmnop'
    const dashboardAuth = await createDashboardAuthenticator({
      mode: 'password',
      sessionSecret,
      users: [{ username: 'u', passwordHash: 'unused', displayName: 'U' }]
    })
    collector = createCollector({ dbPath: ':memory:', port: 0, dashboardAuth })
    const { port } = await collector.listen()
    const base = `http://127.0.0.1:${port}`

    const blocked = await fetch(`${base}/api/spans`)
    expect(blocked.status).toBe(401)

    const session = (await fetch(`${base}/api/session`)).status
    expect(session).toBe(200)

    const codec = createSessionCodec(new TextEncoder().encode(sessionSecret))
    const token = await codec.issue({ subject: 'u', displayName: 'U' }, 3600)
    const allowed = await fetch(`${base}/api/spans`, { headers: { cookie: `apiscope_session=${token}` } })
    expect(allowed.status).toBe(200)

    const health = await fetch(`${base}/health`)
    expect(health.status).toBe(200)
  })

  it('refuses to start unauthenticated on a non-loopback bind', async () => {
    collector = undefined
    const dashboardAuth = await createDashboardAuthenticator({ mode: 'none' })
    expect(() => createCollector({ dbPath: ':memory:', port: 0, host: '0.0.0.0', dashboardAuth })).toThrow(/insecure/i)
  })
})
