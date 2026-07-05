import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createNoneIngestAuthenticator, createTokenIngestAuthenticator } from '../src/auth/ingest-auth'

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

describe('createNoneIngestAuthenticator', () => {
  it('derives app from header and never rejects', () => {
    const authenticator = createNoneIngestAuthenticator()
    expect(authenticator.authenticate(request({ 'x-apiscope-app': 'web' }))).toEqual({ appName: 'web' })
    expect(authenticator.authenticate(request({}))).toEqual({ appName: '' })
  })
})

describe('createTokenIngestAuthenticator', () => {
  const authenticator = createTokenIngestAuthenticator([
    { appName: 'web', token: 'token-web' },
    { appName: 'api', token: 'token-api' }
  ])

  it('accepts a valid bearer token and returns the authoritative app', () => {
    expect(authenticator.authenticate(request({ authorization: 'Bearer token-web', 'x-apiscope-app': 'spoofed' }))).toEqual({
      appName: 'web'
    })
  })

  it('accepts the x-apiscope-token header', () => {
    expect(authenticator.authenticate(request({ 'x-apiscope-token': 'token-api' }))).toEqual({ appName: 'api' })
  })

  it('rejects a missing or wrong token', () => {
    expect(authenticator.authenticate(request({}))).toBeNull()
    expect(authenticator.authenticate(request({ authorization: 'Bearer nope' }))).toBeNull()
  })
})
