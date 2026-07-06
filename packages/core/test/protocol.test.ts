import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MAX_ROUTES_PER_MESSAGE, MAX_SPANS_PER_MESSAGE, PROTOCOL_VERSION } from '../src/constants'
import { decodeWireMessage, encodeWireMessage } from '../src/protocol'
import type { HandshakeMessage, ProfileRequestMessage, ProfileResultMessage, SpanBatchMessage, WireMessage } from '../src/protocol'
import type { FlameNode, RequestSpan } from '../src/types'
import { validChildSpan, validDbChildSpan, validRequestSpan } from './validate.test'

const flamegraph: FlameNode = {
  name: '(program)',
  file: '',
  line: 0,
  value: 1200,
  children: [{ name: 'busy', file: 'file:///app.js', line: 4, value: 1200, children: [] }]
}

const profileRequest: ProfileRequestMessage = {
  type: 'profile-request',
  protocolVersion: PROTOCOL_VERSION,
  requestId: 'req-1',
  durationMs: 500
}

const profileResult: ProfileResultMessage = {
  type: 'profile-result',
  protocolVersion: PROTOCOL_VERSION,
  requestId: 'req-1',
  ok: true,
  flamegraph,
  pprofBase64: 'AAA='
}

const handshake: HandshakeMessage = {
  type: 'handshake',
  protocolVersion: PROTOCOL_VERSION,
  app: { name: 'demo', framework: 'fastify', runtime: 'node', pid: 123 },
  routes: [{ method: 'GET', pattern: '/health' }]
}

const batch: SpanBatchMessage = {
  type: 'span-batch',
  protocolVersion: PROTOCOL_VERSION,
  spans: [validRequestSpan],
  childSpans: [validChildSpan],
  droppedCount: 0
}

describe('encodeWireMessage and decodeWireMessage', () => {
  it('round-trips every message type', () => {
    const messages: WireMessage[] = [
      handshake,
      batch,
      { type: 'registry-update', protocolVersion: PROTOCOL_VERSION, routes: [{ method: 'POST', pattern: '/users', sourceFile: 'src/users.ts' }] },
      profileRequest,
      profileResult,
      { type: 'profile-result', protocolVersion: PROTOCOL_VERSION, requestId: 'req-2', ok: false, error: 'profiler unavailable' }
    ]
    for (const message of messages) {
      const decoded = decodeWireMessage(encodeWireMessage(message))
      expect(decoded).toEqual({ ok: true, message })
    }
  })

  it('rejects a profile-request missing requestId or durationMs', () => {
    const decoded = decodeWireMessage(
      JSON.stringify({ type: 'profile-request', protocolVersion: PROTOCOL_VERSION, requestId: '', durationMs: -1 })
    )
    expect(decoded).toEqual({
      ok: false,
      error: {
        kind: 'invalid-shape',
        issues: [
          { path: 'requestId', expected: 'non-empty string' },
          { path: 'durationMs', expected: 'positive number' }
        ]
      }
    })
  })

  it('rejects a profile-result with a malformed nested flamegraph', () => {
    const decoded = decodeWireMessage(
      JSON.stringify({
        type: 'profile-result',
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'req-3',
        ok: true,
        flamegraph: { name: '(program)', file: '', line: 0, value: 'not-a-number', children: [] }
      })
    )
    expect(decoded).toEqual({
      ok: false,
      error: { kind: 'invalid-shape', issues: [{ path: 'flamegraph.value', expected: 'number' }] }
    })
  })

  it('round-trips a span batch carrying a db child span', () => {
    const dbBatch: SpanBatchMessage = {
      type: 'span-batch',
      protocolVersion: PROTOCOL_VERSION,
      spans: [validRequestSpan],
      childSpans: [validChildSpan, validDbChildSpan],
      droppedCount: 0
    }
    const decoded = decodeWireMessage(encodeWireMessage(dbBatch))
    expect(decoded).toEqual({ ok: true, message: dbBatch })
  })

  it('rejects invalid json', () => {
    expect(decodeWireMessage('{oops')).toEqual({ ok: false, error: { kind: 'invalid-json' } })
  })

  it('rejects version mismatches with both versions', () => {
    const decoded = decodeWireMessage(JSON.stringify({ ...handshake, protocolVersion: 99 }))
    expect(decoded).toEqual({
      ok: false,
      error: { kind: 'version-mismatch', received: 99, supported: PROTOCOL_VERSION }
    })
  })

  it('rejects unknown message types', () => {
    const decoded = decodeWireMessage(JSON.stringify({ type: 'nope', protocolVersion: PROTOCOL_VERSION }))
    expect(decoded).toEqual({
      ok: false,
      error: {
        kind: 'invalid-shape',
        issues: [{ path: 'type', expected: 'handshake | span-batch | registry-update | profile-request | profile-result' }]
      }
    })
  })

  it('reports span issues with indexed paths', () => {
    const brokenSpan = { ...validRequestSpan, statusCode: 'x' } as unknown as RequestSpan
    const decoded = decodeWireMessage(encodeWireMessage({ ...batch, spans: [brokenSpan] }))
    expect(decoded).toEqual({
      ok: false,
      error: { kind: 'invalid-shape', issues: [{ path: 'spans[0].statusCode', expected: 'number' }] }
    })
  })

  it('rejects a span batch exceeding the combined array cap', () => {
    const overflow = MAX_SPANS_PER_MESSAGE + 1
    const spans = Array.from({ length: overflow }, () => validRequestSpan)
    const decoded = decodeWireMessage(
      JSON.stringify({ type: 'span-batch', protocolVersion: PROTOCOL_VERSION, spans, childSpans: [], droppedCount: 0 })
    )
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.kind).toBe('invalid-shape')
  })

  it('rejects a registry-update exceeding the routes cap', () => {
    const overflow = MAX_ROUTES_PER_MESSAGE + 1
    const routes = Array.from({ length: overflow }, () => ({ method: 'GET', pattern: '/health' }))
    const decoded = decodeWireMessage(
      JSON.stringify({ type: 'registry-update', protocolVersion: PROTOCOL_VERSION, routes })
    )
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.kind).toBe('invalid-shape')
  })

  it('round-trips arbitrary span batches', () => {
    const timingArbitrary = fc.record({
      start: fc.integer({ min: 0 }),
      ttfb: fc.option(fc.integer({ min: 0 }), { nil: null }),
      duration: fc.integer({ min: 0 })
    })
    const spanArbitrary = fc.record(
      {
        id: fc.string(),
        traceId: fc.string(),
        parentSpanId: fc.string(),
        loadRunId: fc.string(),
        method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'QUERY'),
        routePattern: fc.option(fc.string(), { nil: null }),
        actualPath: fc.string(),
        statusCode: fc.integer({ min: 100, max: 599 }),
        timing: timingArbitrary,
        framework: fc.string(),
        runtime: fc.constantFrom('node', 'bun', 'deno', 'edge')
      },
      { requiredKeys: ['id', 'traceId', 'method', 'routePattern', 'actualPath', 'statusCode', 'timing', 'framework', 'runtime'] }
    )
    fc.assert(
      fc.property(fc.array(spanArbitrary, { maxLength: 5 }), fc.nat(), (spans, droppedCount) => {
        const message: SpanBatchMessage = {
          type: 'span-batch',
          protocolVersion: PROTOCOL_VERSION,
          spans: spans as RequestSpan[],
          childSpans: [],
          droppedCount
        }
        const decoded = decodeWireMessage(encodeWireMessage(message))
        expect(decoded).toEqual({ ok: true, message })
      })
    )
  })
})
