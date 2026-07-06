import type { IncomingMessage } from 'node:http'

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function originHostPort(origin: string): string | null {
  try {
    const url = new URL(origin)
    return url.host
  } catch {
    return null
  }
}

export function isAllowedOrigin(request: IncomingMessage, allowedOrigins: string[]): boolean {
  const origin = headerValue(request, 'origin')
  if (origin === null) return true
  const originHost = originHostPort(origin)
  if (originHost === null) return false
  const host = headerValue(request, 'host')
  if (host !== null && originHost === host) return true
  return allowedOrigins.some((allowed) => allowed === origin || originHostPort(allowed) === originHost)
}
