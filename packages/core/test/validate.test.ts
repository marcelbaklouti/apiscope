import { describe, expect, it } from 'vitest'
import { validateChildSpan, validateRequestSpan, validateRouteRegistryEntry } from '../src/validate'
import type { ChildSpan, RequestSpan } from '../src/types'

export const validRequestSpan: RequestSpan = {
  id: 'span-1',
  traceId: 'trace-1',
  method: 'GET',
  routePattern: '/users/:id',
  actualPath: '/users/42',
  statusCode: 200,
  timing: { start: 1751630000000, ttfb: 12.5, duration: 48.2 },
  framework: 'express',
  runtime: 'node'
}

export const validChildSpan: ChildSpan = {
  id: 'child-1',
  parentSpanId: 'span-1',
  traceId: 'trace-1',
  kind: 'fetch',
  url: 'https://api.example.com/data',
  method: 'GET',
  statusCode: 200,
  timing: { start: 1751630000010, ttfb: 8, duration: 20 }
}

describe('validateRequestSpan', () => {
  it('accepts a valid span', () => {
    expect(validateRequestSpan(validRequestSpan)).toEqual([])
  })

  it('accepts null routePattern and optional error and payloads', () => {
    const span: RequestSpan = {
      ...validRequestSpan,
      routePattern: null,
      error: { message: 'boom', digest: 'D1', stack: 'at handler' },
      request: { headers: { accept: 'application/json' }, truncated: false, redactedHeaders: [] },
      response: { headers: {}, body: '{"ok":true}', truncated: true, redactedHeaders: ['set-cookie'] }
    }
    expect(validateRequestSpan(span)).toEqual([])
  })

  it('reports path and expectation for wrong types', () => {
    const broken = { ...validRequestSpan, statusCode: 'ok', timing: { start: 1, ttfb: null, duration: 'x' } }
    const issues = validateRequestSpan(broken)
    expect(issues).toContainEqual({ path: 'statusCode', expected: 'number' })
    expect(issues).toContainEqual({ path: 'timing.duration', expected: 'number' })
  })

  it('rejects unknown runtime values', () => {
    const broken = { ...validRequestSpan, runtime: 'php' }
    expect(validateRequestSpan(broken)).toContainEqual({ path: 'runtime', expected: 'node | bun | deno | edge' })
  })

  it('rejects non-objects', () => {
    expect(validateRequestSpan(null)).toEqual([{ path: '', expected: 'object' }])
  })
})

describe('validateChildSpan', () => {
  it('accepts a valid child span', () => {
    expect(validateChildSpan(validChildSpan)).toEqual([])
  })

  it('accepts null statusCode', () => {
    expect(validateChildSpan({ ...validChildSpan, statusCode: null })).toEqual([])
  })

  it('rejects missing parentSpanId', () => {
    const { parentSpanId, ...rest } = validChildSpan
    expect(validateChildSpan(rest)).toContainEqual({ path: 'parentSpanId', expected: 'string' })
  })
})

describe('validateRouteRegistryEntry', () => {
  it('accepts entries with and without sourceFile', () => {
    expect(validateRouteRegistryEntry({ method: 'GET', pattern: '/health' })).toEqual([])
    expect(validateRouteRegistryEntry({ method: 'POST', pattern: '/users', sourceFile: 'src/users.ts' })).toEqual([])
  })

  it('rejects missing pattern', () => {
    expect(validateRouteRegistryEntry({ method: 'GET' })).toContainEqual({ path: 'pattern', expected: 'string' })
  })
})
