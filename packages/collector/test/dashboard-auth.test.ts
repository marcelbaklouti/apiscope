import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { hash } from 'argon2'
import { describe, expect, it } from 'vitest'
import { createDashboardAuthenticator } from '../src/auth/dashboard-auth'
import { createSessionCodec } from '../src/auth/session'

function request(headers: Record<string, string>, remoteAddress?: string): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage
}

describe('session codec', () => {
  it('round-trips claims and rejects tampering', async () => {
    const codec = createSessionCodec(new TextEncoder().encode('a-very-long-test-secret-value-0123456789'))
    const token = await codec.issue({ subject: 'u1', displayName: 'User One' }, 3600)
    expect(await codec.verify(token)).toEqual({ subject: 'u1', displayName: 'User One' })
    expect(await codec.verify(`${token}tampered`)).toBeNull()
    expect(await codec.verify('not-a-jwt')).toBeNull()
  })
})

describe('proxy authenticator', () => {
  it('reads identity from the trusted header when the request comes from a trusted proxy', async () => {
    const authenticator = await createDashboardAuthenticator({
      mode: 'proxy',
      userHeader: 'x-forwarded-user',
      nameHeader: 'x-forwarded-name',
      trustedProxies: ['10.0.0.1']
    })
    expect(
      await authenticator.authenticate(request({ 'x-forwarded-user': 'alice', 'x-forwarded-name': 'Alice A' }, '10.0.0.1'))
    ).toEqual({ subject: 'alice', displayName: 'Alice A' })
    expect(await authenticator.authenticate(request({}, '10.0.0.1'))).toBeNull()
  })

  it('rejects the forwarded header when the request is not from a trusted proxy', async () => {
    const authenticator = await createDashboardAuthenticator({
      mode: 'proxy',
      userHeader: 'x-forwarded-user',
      trustedProxies: ['10.0.0.1']
    })
    expect(await authenticator.authenticate(request({ 'x-forwarded-user': 'attacker' }, '203.0.113.9'))).toBeNull()
  })

  it('fails closed when no trusted proxies are configured', async () => {
    const authenticator = await createDashboardAuthenticator({ mode: 'proxy', userHeader: 'x-forwarded-user' })
    expect(await authenticator.authenticate(request({ 'x-forwarded-user': 'attacker' }, '10.0.0.1'))).toBeNull()
  })

  it('accepts an ipv4-mapped remote address matching a trusted proxy', async () => {
    const authenticator = await createDashboardAuthenticator({
      mode: 'proxy',
      userHeader: 'x-forwarded-user',
      trustedProxies: ['10.0.0.1']
    })
    expect(await authenticator.authenticate(request({ 'x-forwarded-user': 'alice' }, '::ffff:10.0.0.1'))).toEqual({
      subject: 'alice',
      displayName: 'alice'
    })
  })
})

describe('none authenticator', () => {
  it('returns a static anonymous identity', async () => {
    const authenticator = await createDashboardAuthenticator({ mode: 'none' })
    expect(await authenticator.authenticate(request({}))).toEqual({ subject: 'anonymous', displayName: 'anonymous' })
  })
})

describe('password authenticator', () => {
  it('accepts a valid session cookie and rejects a missing one', async () => {
    const sessionSecret = 'another-long-secret-value-for-passwords-9876'
    const passwordHash = await hash('correct horse')
    const authenticator = await createDashboardAuthenticator({
      mode: 'password',
      sessionSecret,
      users: [{ username: 'bob', passwordHash, displayName: 'Bob' }]
    })
    expect(await authenticator.authenticate(request({}))).toBeNull()
    const codec = createSessionCodec(new TextEncoder().encode(sessionSecret))
    const token = await codec.issue({ subject: 'bob', displayName: 'Bob' }, 3600)
    expect(await authenticator.authenticate(request({ cookie: `apiscope_session=${token}` }))).toEqual({
      subject: 'bob',
      displayName: 'Bob'
    })
  })

  it('returns invalid-credentials for a nonexistent user', async () => {
    const passwordHash = await hash('correct horse')
    const authenticator = await createDashboardAuthenticator({
      mode: 'password',
      sessionSecret: 'another-long-secret-value-for-passwords-9876',
      users: [{ username: 'bob', passwordHash, displayName: 'Bob' }]
    })
    const login = authenticator.routes.get('POST /auth/login')
    expect(login).toBeDefined()
    const loginRequest = Object.assign(Readable.from([JSON.stringify({ username: 'ghost', password: 'whatever' })]), {
      headers: {}
    }) as unknown as IncomingMessage
    let statusCode = 0
    let bodyText = ''
    const loginResponse = {
      writeHead(code: number) {
        statusCode = code
        return this
      },
      end(chunk?: string) {
        if (chunk !== undefined) bodyText = chunk
        return this
      }
    } as unknown as ServerResponse
    await login!(loginRequest, loginResponse, new URL('http://localhost/auth/login'))
    expect(statusCode).toBe(401)
    expect(JSON.parse(bodyText)).toEqual({ error: 'invalid-credentials' })
  })
})
