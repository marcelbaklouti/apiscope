import { PROTOCOL_VERSION } from './constants'
import type { ChildSpan, RequestSpan, RouteRegistryEntry, Runtime } from './types'
import {
  validateChildSpan,
  validateRequestSpan,
  validateRouteRegistryEntry,
  type ValidationIssue
} from './validate'

export interface AppMetadata {
  name: string
  framework: string
  runtime: Runtime
  pid?: number
}

export interface HandshakeMessage {
  type: 'handshake'
  protocolVersion: number
  app: AppMetadata
  routes: RouteRegistryEntry[]
}

export interface SpanBatchMessage {
  type: 'span-batch'
  protocolVersion: number
  spans: RequestSpan[]
  childSpans: ChildSpan[]
  droppedCount: number
}

export interface RegistryUpdateMessage {
  type: 'registry-update'
  protocolVersion: number
  routes: RouteRegistryEntry[]
}

export type WireMessage = HandshakeMessage | SpanBatchMessage | RegistryUpdateMessage

export type DecodeError =
  | { kind: 'invalid-json' }
  | { kind: 'version-mismatch'; received: unknown; supported: number }
  | { kind: 'invalid-shape'; issues: ValidationIssue[] }

export type DecodeResult = { ok: true; message: WireMessage } | { ok: false; error: DecodeError }

const messageTypes = ['handshake', 'span-batch', 'registry-update'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function prefixIssues(issues: ValidationIssue[], prefix: string): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path === '' ? prefix : `${prefix}.${issue.path}`,
    expected: issue.expected
  }))
}

function validateEntries(
  value: unknown,
  field: string,
  validateEntry: (entry: unknown) => ValidationIssue[]
): ValidationIssue[] {
  if (!Array.isArray(value)) return [{ path: field, expected: 'array' }]
  return value.flatMap((entry, index) => prefixIssues(validateEntry(entry), `${field}[${index}]`))
}

function validateHandshake(value: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const app = value['app']
  if (!isRecord(app)) {
    issues.push({ path: 'app', expected: 'object' })
  } else {
    if (typeof app['name'] !== 'string') issues.push({ path: 'app.name', expected: 'string' })
    if (typeof app['framework'] !== 'string') issues.push({ path: 'app.framework', expected: 'string' })
    if (!['node', 'bun', 'deno', 'edge'].includes(app['runtime'] as string)) {
      issues.push({ path: 'app.runtime', expected: 'node | bun | deno | edge' })
    }
    if (app['pid'] !== undefined && typeof app['pid'] !== 'number') {
      issues.push({ path: 'app.pid', expected: 'number' })
    }
  }
  issues.push(...validateEntries(value['routes'], 'routes', validateRouteRegistryEntry))
  return issues
}

function validateSpanBatch(value: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  issues.push(...validateEntries(value['spans'], 'spans', validateRequestSpan))
  issues.push(...validateEntries(value['childSpans'], 'childSpans', validateChildSpan))
  if (typeof value['droppedCount'] !== 'number' || value['droppedCount'] < 0) {
    issues.push({ path: 'droppedCount', expected: 'non-negative number' })
  }
  return issues
}

export function encodeWireMessage(message: WireMessage): string {
  return JSON.stringify(message)
}

export function decodeWireMessage(raw: string): DecodeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: { kind: 'invalid-json' } }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: { kind: 'invalid-shape', issues: [{ path: '', expected: 'object' }] } }
  }
  if (parsed['protocolVersion'] !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: { kind: 'version-mismatch', received: parsed['protocolVersion'], supported: PROTOCOL_VERSION }
    }
  }
  const type = parsed['type']
  if (typeof type !== 'string' || !messageTypes.includes(type as (typeof messageTypes)[number])) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', issues: [{ path: 'type', expected: messageTypes.join(' | ') }] }
    }
  }
  const issues =
    type === 'handshake'
      ? validateHandshake(parsed)
      : type === 'span-batch'
        ? validateSpanBatch(parsed)
        : validateEntries(parsed['routes'], 'routes', validateRouteRegistryEntry)
  if (issues.length > 0) return { ok: false, error: { kind: 'invalid-shape', issues } }
  return { ok: true, message: parsed as unknown as WireMessage }
}
