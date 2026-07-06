import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { verify as verifyPassword } from 'argon2'
import { parseCookie, stringifySetCookie } from 'cookie'
import * as openidClient from 'openid-client'
import { createPendingStateStore } from './pending-state'
import { createSessionCodec, type SessionCodec } from './session'

export interface DashboardIdentity {
  subject: string
  displayName: string
}

type RouteHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<void>

export interface DashboardAuthenticator {
  authenticate(request: IncomingMessage): Promise<DashboardIdentity | null>
  routes: Map<string, RouteHandler>
  requiresLoginRedirect: boolean
  readonly mode: DashboardAuthConfig['mode']
}

export type DashboardAuthConfig =
  | { mode: 'none' }
  | { mode: 'password'; sessionSecret: string; users: Array<{ username: string; passwordHash: string; displayName?: string }> }
  | { mode: 'oidc'; sessionSecret: string; issuer: string; clientId: string; clientSecret: string; redirectUri: string }
  | { mode: 'proxy'; userHeader: string; nameHeader?: string }

const sessionCookieName = 'apiscope_session'
const sessionTtlSeconds = 60 * 60 * 12
const pendingLoginTtlMs = 10 * 60 * 1000
const maxPendingLogins = 1000

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function readSessionToken(request: IncomingMessage): string | null {
  const cookieHeader = headerValue(request, 'cookie')
  if (cookieHeader === null) return null
  return parseCookie(cookieHeader)[sessionCookieName] ?? null
}

function setSessionCookie(response: ServerResponse, token: string): void {
  response.setHeader(
    'set-cookie',
    stringifySetCookie({ name: sessionCookieName, value: token, httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: sessionTtlSeconds })
  )
}

function clearSessionCookie(response: ServerResponse): void {
  response.setHeader(
    'set-cookie',
    stringifySetCookie({ name: sessionCookieName, value: '', httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 0 })
  )
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function createDashboardAuthenticator(config: DashboardAuthConfig): Promise<DashboardAuthenticator> {
  if (config.mode === 'none') {
    return {
      async authenticate() {
        return { subject: 'anonymous', displayName: 'anonymous' }
      },
      routes: new Map(),
      requiresLoginRedirect: false,
      mode: 'none'
    }
  }

  if (config.mode === 'proxy') {
    return {
      async authenticate(request) {
        const subject = headerValue(request, config.userHeader.toLowerCase())
        if (subject === null) return null
        const displayName = config.nameHeader === undefined ? subject : (headerValue(request, config.nameHeader.toLowerCase()) ?? subject)
        return { subject, displayName }
      },
      routes: new Map(),
      requiresLoginRedirect: false,
      mode: 'proxy'
    }
  }

  const codec: SessionCodec = createSessionCodec(new TextEncoder().encode(config.sessionSecret))
  const routes = new Map<string, RouteHandler>()

  if (config.mode === 'password') {
    routes.set('POST /auth/login', async (request, response) => {
      const body = await readJsonBody(request)
      const username = typeof body['username'] === 'string' ? body['username'] : ''
      const password = typeof body['password'] === 'string' ? body['password'] : ''
      const user = config.users.find((entry) => entry.username === username)
      const ok = user !== undefined && (await verifyPassword(user.passwordHash, password))
      if (!ok || user === undefined) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'invalid-credentials' }))
        return
      }
      const token = await codec.issue({ subject: user.username, displayName: user.displayName ?? user.username }, sessionTtlSeconds)
      setSessionCookie(response, token)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
    routes.set('POST /auth/logout', async (request, response) => {
      clearSessionCookie(response)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
    return {
      async authenticate(request) {
        const token = readSessionToken(request)
        if (token === null) return null
        return codec.verify(token)
      },
      routes,
      requiresLoginRedirect: true,
      mode: 'password'
    }
  }

  const oidcConfig = await openidClient.discovery(new URL(config.issuer), config.clientId, config.clientSecret)
  const pendingByState = createPendingStateStore<{ verifier: string }>({ ttlMs: pendingLoginTtlMs, maxEntries: maxPendingLogins })

  routes.set('GET /auth/login', async (request, response) => {
    const verifier = openidClient.randomPKCECodeVerifier()
    const challenge = await openidClient.calculatePKCECodeChallenge(verifier)
    const state = randomUUID()
    pendingByState.set(state, { verifier })
    const authorizationUrl = openidClient.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: config.redirectUri,
      scope: 'openid profile email',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state
    })
    response.writeHead(302, { location: authorizationUrl.href })
    response.end()
  })

  routes.set('GET /auth/callback', async (request, response, url) => {
    const state = url.searchParams.get('state') ?? ''
    const pending = pendingByState.get(state)
    if (pending === undefined) {
      response.writeHead(400)
      response.end('invalid state')
      return
    }
    pendingByState.delete(state)
    const currentUrl = new URL(`${config.redirectUri}${url.search}`)
    const tokens = await openidClient.authorizationCodeGrant(oidcConfig, currentUrl, {
      pkceCodeVerifier: pending.verifier,
      expectedState: state
    })
    const claims = tokens.claims()
    const subject = claims?.sub ?? 'unknown'
    const displayName = typeof claims?.['name'] === 'string' ? claims['name'] : subject
    const token = await codec.issue({ subject, displayName }, sessionTtlSeconds)
    setSessionCookie(response, token)
    response.writeHead(302, { location: '/' })
    response.end()
  })

  routes.set('POST /auth/logout', async (request, response) => {
    clearSessionCookie(response)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
  })

  return {
    async authenticate(request) {
      const token = readSessionToken(request)
      if (token === null) return null
      return codec.verify(token)
    },
    routes,
    requiresLoginRedirect: true,
    mode: 'oidc'
  }
}
