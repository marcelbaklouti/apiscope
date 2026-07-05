import { BODY_CAPTURE_LIMIT_BYTES, DEFAULT_REDACTED_HEADERS } from './constants'
import type { CapturedPayload } from './types'

const REDACTED_VALUE = '[redacted]'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: false })

export function redactHeaders(
  headers: Record<string, string>,
  additionalRedacted: string[] = []
): { headers: Record<string, string>; redactedHeaders: string[] } {
  const redactedNames = new Set([
    ...DEFAULT_REDACTED_HEADERS,
    ...additionalRedacted.map((name) => name.toLowerCase())
  ])
  const outputHeaders: Record<string, string> = {}
  const redactedHeaders: string[] = []
  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase()
    if (redactedNames.has(lowered)) {
      outputHeaders[name] = REDACTED_VALUE
      redactedHeaders.push(lowered)
    } else {
      outputHeaders[name] = value
    }
  }
  return { headers: outputHeaders, redactedHeaders }
}

export function capBody(body: string, limitBytes = BODY_CAPTURE_LIMIT_BYTES): { body: string; truncated: boolean } {
  const encoded = encoder.encode(body)
  if (encoded.byteLength <= limitBytes) return { body, truncated: false }
  let end = limitBytes
  while (end > 0 && (encoded[end]! & 0b11000000) === 0b10000000) end -= 1
  return { body: decoder.decode(encoded.subarray(0, end)), truncated: true }
}

export function buildCapturedPayload(
  headers: Record<string, string>,
  body: string | undefined,
  options: { additionalRedacted?: string[]; limitBytes?: number } = {}
): CapturedPayload {
  const redacted = redactHeaders(headers, options.additionalRedacted ?? [])
  if (body === undefined) {
    return { headers: redacted.headers, truncated: false, redactedHeaders: redacted.redactedHeaders }
  }
  const capped = capBody(body, options.limitBytes ?? BODY_CAPTURE_LIMIT_BYTES)
  return {
    headers: redacted.headers,
    body: capped.body,
    truncated: capped.truncated,
    redactedHeaders: redacted.redactedHeaders
  }
}
