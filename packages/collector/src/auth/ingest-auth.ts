import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export interface IngestIdentity {
  appName: string
}

export interface IngestAuthenticator {
  authenticate(request: IncomingMessage): IngestIdentity | null
}

export interface TokenEntry {
  appName: string
  token: string
}

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function presentedToken(request: IncomingMessage): string | null {
  const authorization = headerValue(request, 'authorization')
  if (authorization !== null && authorization.startsWith('Bearer ')) return authorization.slice(7)
  return headerValue(request, 'x-apiscope-token')
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

export function createNoneIngestAuthenticator(): IngestAuthenticator {
  return {
    authenticate(request) {
      return { appName: headerValue(request, 'x-apiscope-app') ?? '' }
    }
  }
}

export function createTokenIngestAuthenticator(tokens: TokenEntry[]): IngestAuthenticator {
  return {
    authenticate(request) {
      const token = presentedToken(request)
      if (token === null) return null
      for (const entry of tokens) {
        if (constantTimeEqual(entry.token, token)) return { appName: entry.appName }
      }
      return null
    }
  }
}
