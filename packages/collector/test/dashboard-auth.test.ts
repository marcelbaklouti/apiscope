import type { IncomingMessage } from 'node:http'
import { hash } from 'argon2'
import { describe, expect, it } from 'vitest'
import { createDashboardAuthenticator } from '../src/auth/dashboard-auth'
import { createSessionCodec } from '../src/auth/session'

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage
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
  it('reads identity from the trusted header', async () => {
    const authenticator = await createDashboardAuthenticator({ mode: 'proxy', userHeader: 'x-forwarded-user', nameHeader: 'x-forwarded-name' })
    expect(await authenticator.authenticate(request({ 'x-forwarded-user': 'alice', 'x-forwarded-name': 'Alice A' }))).toEqual({
      subject: 'alice',
      displayName: 'Alice A'
    })
    expect(await authenticator.authenticate(request({}))).toBeNull()
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
})
