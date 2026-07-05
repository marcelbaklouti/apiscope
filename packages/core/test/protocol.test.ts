import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../src/index'
import { decodeWireMessage, encodeWireMessage } from '../src/protocol'
import type { HandshakeMessage, SpanBatchMessage, WireMessage } from '../src/protocol'
import type { RequestSpan } from '../src/types'
import { validChildSpan, validDbChildSpan, validRequestSpan } from './validate.test'

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
      { type: 'registry-update', protocolVersion: PROTOCOL_VERSION, routes: [{ method: 'POST', pattern: '/users', sourceFile: 'src/users.ts' }] }
    ]
    for (const message of messages) {
      const decoded = decodeWireMessage(encodeWireMessage(message))
      expect(decoded).toEqual({ ok: true, message })
    }
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
      error: { kind: 'invalid-shape', issues: [{ path: 'type', expected: 'handshake | span-batch | registry-update' }] }
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
