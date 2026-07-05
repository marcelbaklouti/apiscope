import { PROTOCOL_VERSION } from './constants'
import type { ChildSpan, FlameNode, RequestSpan, RouteRegistryEntry, Runtime } from './types'
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

export interface ProfileRequestMessage {
  type: 'profile-request'
  protocolVersion: number
  requestId: string
  durationMs: number
}

export interface ProfileResultMessage {
  type: 'profile-result'
  protocolVersion: number
  requestId: string
  ok: boolean
  flamegraph?: FlameNode
  pprofBase64?: string
  error?: string
}

export type WireMessage =
  | HandshakeMessage
  | SpanBatchMessage
  | RegistryUpdateMessage
  | ProfileRequestMessage
  | ProfileResultMessage

export type DecodeError =
  | { kind: 'invalid-json' }
  | { kind: 'version-mismatch'; received: unknown; supported: number }
  | { kind: 'invalid-shape'; issues: ValidationIssue[] }

export type DecodeResult = { ok: true; message: WireMessage } | { ok: false; error: DecodeError }

const messageTypes = ['handshake', 'span-batch', 'registry-update', 'profile-request', 'profile-result'] as const

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

function validateFlameNode(value: unknown): ValidationIssue[] {
  if (!isRecord(value)) return [{ path: '', expected: 'object' }]
  const issues: ValidationIssue[] = []
  if (typeof value['name'] !== 'string') issues.push({ path: 'name', expected: 'string' })
  if (typeof value['file'] !== 'string') issues.push({ path: 'file', expected: 'string' })
  if (typeof value['line'] !== 'number') issues.push({ path: 'line', expected: 'number' })
  if (typeof value['value'] !== 'number') issues.push({ path: 'value', expected: 'number' })
  issues.push(...validateEntries(value['children'], 'children', validateFlameNode))
  return issues
}

function validateProfileRequest(value: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (typeof value['requestId'] !== 'string' || value['requestId'] === '') {
    issues.push({ path: 'requestId', expected: 'non-empty string' })
  }
  if (typeof value['durationMs'] !== 'number' || value['durationMs'] <= 0) {
    issues.push({ path: 'durationMs', expected: 'positive number' })
  }
  return issues
}

function validateProfileResult(value: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (typeof value['requestId'] !== 'string' || value['requestId'] === '') {
    issues.push({ path: 'requestId', expected: 'non-empty string' })
  }
  if (typeof value['ok'] !== 'boolean') issues.push({ path: 'ok', expected: 'boolean' })
  if (value['flamegraph'] !== undefined) issues.push(...prefixIssues(validateFlameNode(value['flamegraph']), 'flamegraph'))
  if (value['pprofBase64'] !== undefined && typeof value['pprofBase64'] !== 'string') {
    issues.push({ path: 'pprofBase64', expected: 'string' })
  }
  if (value['error'] !== undefined && typeof value['error'] !== 'string') {
    issues.push({ path: 'error', expected: 'string' })
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
        : type === 'registry-update'
          ? validateEntries(parsed['routes'], 'routes', validateRouteRegistryEntry)
          : type === 'profile-request'
            ? validateProfileRequest(parsed)
            : validateProfileResult(parsed)
  if (issues.length > 0) return { ok: false, error: { kind: 'invalid-shape', issues } }
  return { ok: true, message: parsed as unknown as WireMessage }
}
