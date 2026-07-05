import type { Runtime } from './types'

export interface ValidationIssue {
  path: string
  expected: string
}

const runtimes: readonly Runtime[] = ['node', 'bun', 'deno', 'edge']

function joinPath(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(issues: ValidationIssue[], record: Record<string, unknown>, key: string, path: string): void {
  if (typeof record[key] !== 'string') issues.push({ path: joinPath(path, key), expected: 'string' })
}

function requireNumber(issues: ValidationIssue[], record: Record<string, unknown>, key: string, path: string): void {
  if (typeof record[key] !== 'number' || Number.isNaN(record[key])) {
    issues.push({ path: joinPath(path, key), expected: 'number' })
  }
}

function optionalString(issues: ValidationIssue[], record: Record<string, unknown>, key: string, path: string): void {
  if (record[key] !== undefined && typeof record[key] !== 'string') {
    issues.push({ path: joinPath(path, key), expected: 'string' })
  }
}

function validateTiming(value: unknown, path: string): ValidationIssue[] {
  if (!isRecord(value)) return [{ path, expected: 'object' }]
  const issues: ValidationIssue[] = []
  requireNumber(issues, value, 'start', path)
  if (value['ttfb'] !== null && (typeof value['ttfb'] !== 'number' || Number.isNaN(value['ttfb']))) {
    issues.push({ path: joinPath(path, 'ttfb'), expected: 'number | null' })
  }
  requireNumber(issues, value, 'duration', path)
  return issues
}

function validateError(value: unknown, path: string): ValidationIssue[] {
  if (value === undefined) return []
  if (!isRecord(value)) return [{ path, expected: 'object' }]
  const issues: ValidationIssue[] = []
  requireString(issues, value, 'message', path)
  optionalString(issues, value, 'digest', path)
  optionalString(issues, value, 'stack', path)
  return issues
}

function validatePayload(value: unknown, path: string): ValidationIssue[] {
  if (value === undefined) return []
  if (!isRecord(value)) return [{ path, expected: 'object' }]
  const issues: ValidationIssue[] = []
  const headers = value['headers']
  if (!isRecord(headers) || Object.values(headers).some((headerValue) => typeof headerValue !== 'string')) {
    issues.push({ path: joinPath(path, 'headers'), expected: 'Record<string, string>' })
  }
  optionalString(issues, value, 'body', path)
  if (typeof value['truncated'] !== 'boolean') issues.push({ path: joinPath(path, 'truncated'), expected: 'boolean' })
  const redacted = value['redactedHeaders']
  if (!Array.isArray(redacted) || redacted.some((name) => typeof name !== 'string')) {
    issues.push({ path: joinPath(path, 'redactedHeaders'), expected: 'string[]' })
  }
  return issues
}

export function validateRequestSpan(value: unknown): ValidationIssue[] {
  if (!isRecord(value)) return [{ path: '', expected: 'object' }]
  const issues: ValidationIssue[] = []
  requireString(issues, value, 'id', '')
  requireString(issues, value, 'traceId', '')
  optionalString(issues, value, 'parentSpanId', '')
  optionalString(issues, value, 'loadRunId', '')
  requireString(issues, value, 'method', '')
  if (value['routePattern'] !== null && typeof value['routePattern'] !== 'string') {
    issues.push({ path: 'routePattern', expected: 'string | null' })
  }
  requireString(issues, value, 'actualPath', '')
  requireNumber(issues, value, 'statusCode', '')
  issues.push(...validateTiming(value['timing'], 'timing'))
  requireString(issues, value, 'framework', '')
  if (!runtimes.includes(value['runtime'] as Runtime)) {
    issues.push({ path: 'runtime', expected: runtimes.join(' | ') })
  }
  issues.push(...validateError(value['error'], 'error'))
  issues.push(...validatePayload(value['request'], 'request'))
  issues.push(...validatePayload(value['response'], 'response'))
  return issues
}

function validateFetchChildSpan(value: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  requireString(issues, value, 'url', '')
  requireString(issues, value, 'method', '')
  if (value['statusCode'] !== null && (typeof value['statusCode'] !== 'number' || Number.isNaN(value['statusCode']))) {
    issues.push({ path: 'statusCode', expected: 'number | null' })
  }
  return issues
}

function validateDbChildSpan(value: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  requireString(issues, value, 'system', '')
  requireString(issues, value, 'statement', '')
  requireString(issues, value, 'operation', '')
  if (value['target'] !== null && typeof value['target'] !== 'string') {
    issues.push({ path: 'target', expected: 'string | null' })
  }
  if (value['rowCount'] !== null && (typeof value['rowCount'] !== 'number' || Number.isNaN(value['rowCount']))) {
    issues.push({ path: 'rowCount', expected: 'number | null' })
  }
  return issues
}

export function validateChildSpan(value: unknown): ValidationIssue[] {
  if (!isRecord(value)) return [{ path: '', expected: 'object' }]
  const issues: ValidationIssue[] = []
  requireString(issues, value, 'id', '')
  requireString(issues, value, 'parentSpanId', '')
  requireString(issues, value, 'traceId', '')
  issues.push(...validateTiming(value['timing'], 'timing'))
  issues.push(...validateError(value['error'], 'error'))
  const kind = value['kind']
  if (kind === 'fetch') {
    issues.push(...validateFetchChildSpan(value))
  } else if (kind === 'db') {
    issues.push(...validateDbChildSpan(value))
  } else {
    issues.push({ path: 'kind', expected: 'fetch | db' })
  }
  return issues
}

export function validateRouteRegistryEntry(value: unknown): ValidationIssue[] {
  if (!isRecord(value)) return [{ path: '', expected: 'object' }]
  const issues: ValidationIssue[] = []
  requireString(issues, value, 'method', '')
  requireString(issues, value, 'pattern', '')
  optionalString(issues, value, 'sourceFile', '')
  return issues
}
