import { describe, expect, it } from 'vitest'
import type { ChildSpan, RequestSpan } from '@apiscope/core'
import { exportRequestToSpans, spansToExportRequest } from '../src/otlp/mapping'

const parent: RequestSpan = {
  id: 'aaaaaaaaaaaaaaaa',
  traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  method: 'GET',
  routePattern: '/users/:id',
  actualPath: '/users/42',
  statusCode: 200,
  timing: { start: 1_700_000_000_000, ttfb: 5, duration: 12 },
  framework: 'express',
  runtime: 'node'
}

const child: ChildSpan = {
  id: 'cccccccccccccccc',
  parentSpanId: 'aaaaaaaaaaaaaaaa',
  traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  kind: 'fetch',
  url: 'http://downstream/api',
  method: 'GET',
  statusCode: 200,
  timing: { start: 1_700_000_000_002, ttfb: 3, duration: 5 }
}

describe('otlp mapping', () => {
  it('maps apiscope spans to an export request with semantic-convention attributes', () => {
    const request = spansToExportRequest([parent], [child], { serviceName: 'demo' })
    const resourceSpan = request.resourceSpans[0]!
    expect(resourceSpan.resource.attributes.find((attribute) => attribute.key === 'service.name')?.value.stringValue).toBe('demo')
    const otlpSpans = resourceSpan.scopeSpans[0]!.spans
    const server = otlpSpans.find((span) => span.kind === 2)!
    expect(server.traceId).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(server.name).toBe('GET /users/:id')
    expect(server.attributes.find((attribute) => attribute.key === 'http.request.method')?.value.stringValue).toBe('GET')
    expect(server.attributes.find((attribute) => attribute.key === 'http.response.status_code')?.value.intValue).toBe('200')
    const clientSpan = otlpSpans.find((span) => span.kind === 3)!
    expect(clientSpan.parentSpanId).toBe('aaaaaaaaaaaaaaaa')
  })

  it('round-trips an export request back into apiscope spans', () => {
    const request = spansToExportRequest([parent], [child], { serviceName: 'demo' })
    const { spans, childSpans } = exportRequestToSpans(request)
    expect(spans).toHaveLength(1)
    expect(spans[0]?.method).toBe('GET')
    expect(spans[0]?.routePattern).toBe('/users/:id')
    expect(spans[0]?.statusCode).toBe(200)
    expect(childSpans).toHaveLength(1)
    expect(childSpans[0]?.parentSpanId).toBe('aaaaaaaaaaaaaaaa')
  })

  it('accepts legacy attribute keys on import', () => {
    const request = spansToExportRequest([parent], [], { serviceName: 'demo' })
    const server = request.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    server.attributes = [
      { key: 'http.method', value: { stringValue: 'POST' } },
      { key: 'http.status_code', value: { intValue: '201' } },
      { key: 'http.route', value: { stringValue: '/legacy' } }
    ]
    const { spans } = exportRequestToSpans(request)
    expect(spans[0]?.method).toBe('POST')
    expect(spans[0]?.statusCode).toBe(201)
    expect(spans[0]?.routePattern).toBe('/legacy')
  })
})
