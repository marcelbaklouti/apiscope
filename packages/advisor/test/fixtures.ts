import type { DbChildSpan, FetchChildSpan, RequestSpan } from '@apiscope/core'
import type { AdvisorContext, AdvisorRouteStats } from '../src/types'
import { defaultAdvisorConfig } from '../src/config'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

export function span(overrides: Partial<RequestSpan> = {}): RequestSpan {
  return {
    id: nextId('span'),
    traceId: nextId('trace'),
    method: 'GET',
    routePattern: '/api/users/:id',
    actualPath: '/api/users/1',
    statusCode: 200,
    timing: { start: 0, ttfb: 2, duration: 10 },
    framework: 'express',
    runtime: 'node',
    ...overrides
  }
}

export function dbChild(parentSpanId: string, overrides: Partial<DbChildSpan> = {}): DbChildSpan {
  return {
    id: nextId('db'),
    parentSpanId,
    traceId: nextId('trace'),
    kind: 'db',
    system: 'postgresql',
    statement: 'SELECT * FROM comments WHERE post_id = 1',
    operation: 'SELECT',
    target: 'appdb',
    rowCount: 1,
    timing: { start: 0, ttfb: null, duration: 3 },
    ...overrides
  }
}

export function fetchChild(parentSpanId: string, overrides: Partial<FetchChildSpan> = {}): FetchChildSpan {
  return {
    id: nextId('fetch'),
    parentSpanId,
    traceId: nextId('trace'),
    kind: 'fetch',
    url: 'http://127.0.0.1:9000/api',
    method: 'GET',
    statusCode: 200,
    timing: { start: 0, ttfb: 5, duration: 40 },
    ...overrides
  }
}

export function routeStat(overrides: Partial<AdvisorRouteStats> = {}): AdvisorRouteStats {
  return { routePattern: '/api/users/:id', method: 'GET', count: 40, errorCount: 0, p50: 10, p95: 20, p99: 30, ...overrides }
}

export function context(parts: Partial<AdvisorContext>): AdvisorContext {
  return {
    spans: [],
    childSpans: [],
    routeStats: [],
    apps: [{ name: 'demo', framework: 'express' }],
    config: defaultAdvisorConfig(),
    ...parts
  }
}
